// Report v2 (PLAN Phase 5 + UX feedback): the mirror, with the ledger behind
// it. Period views (day/week/month/year), repo-grouped files, colored output,
// and an automatic hand-written sync so committed work is credited without a
// manual `ledger sync` step.
import { execSync } from "node:child_process";
import { loadConfig, dataPaths } from "../config.ts";
import { classifyAll } from "../classifier.ts";
import { c, splitBar } from "../colors.ts";
import { daysUntilDecay, effectiveP, isClaimedOnly, loadLedger, saveLedger, syncUnderstanding } from "../ledger.ts";
import { readEvents } from "../log.ts";
import { syncHandwritten } from "../sync.ts";
import { readOverrides } from "./override.ts";
import type { ClassifyCache, Ledger, MirrorEvent } from "../types.ts";
import { normalizePath } from "../util.ts";
import { loadVaultConcepts } from "../vault.ts";

export type PeriodUnit = "day" | "week" | "month" | "year";

interface Period {
  start: Date;
  end: Date;
}

/** Calendar period `back` steps before the current one. Weeks run Sun–Sat. */
export function periodRange(unit: PeriodUnit, back = 0, now = new Date()): Period {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  switch (unit) {
    case "day":
      start.setDate(start.getDate() - back);
      break;
    case "week":
      start.setDate(start.getDate() - start.getDay() - back * 7);
      break;
    case "month":
      start.setDate(1);
      start.setMonth(start.getMonth() - back);
      break;
    case "year":
      start.setMonth(0, 1);
      start.setFullYear(start.getFullYear() - back);
      break;
  }
  const end = new Date(start);
  switch (unit) {
    case "day":
      break;
    case "week":
      end.setDate(start.getDate() + 6);
      break;
    case "month":
      end.setMonth(start.getMonth() + 1, 0);
      break;
    case "year":
      end.setMonth(11, 31);
      break;
  }
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Local date, not toISOString() — UTC rendering shifts +07:00 users back a day.
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function periodLabel(unit: PeriodUnit, p: Period): string {
  switch (unit) {
    case "day": return iso(p.start);
    case "week": return `week of ${iso(p.start)} → ${iso(p.end)}`;
    case "month": return `${MONTHS[p.start.getMonth()]} ${p.start.getFullYear()}`;
    case "year": return String(p.start.getFullYear());
  }
}

function shortLabel(unit: PeriodUnit, p: Period): string {
  switch (unit) {
    case "day": return iso(p.start).slice(5);
    case "week": return `wk ${iso(p.start).slice(5)}`;
    case "month": return `${MONTHS[p.start.getMonth()]}`;
    case "year": return String(p.start.getFullYear());
  }
}

function gitTotalLinesAdded(repoPath: string, since: string, until: string): number {
  try {
    const out = execSync(
      `git log --since="${since}" --until="${until}" --pretty=tformat: --numstat`,
      { cwd: repoPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    return out
      .trim()
      .split("\n")
      .filter(Boolean)
      .reduce((sum, line) => {
        const added = parseInt(line.split("\t")[0] ?? "0", 10);
        return sum + (isNaN(added) ? 0 : added);
      }, 0);
  } catch {
    return 0;
  }
}

type SkillBucket = "within" | "beyond" | "claimed";

function bucketOf(ledger: Ledger, concept: string): SkillBucket {
  const entry = ledger.concepts[concept];
  if (!entry) return "beyond";
  if (isClaimedOnly(entry)) return effectiveP(entry) > 0 ? "claimed" : "beyond";
  return effectiveP(entry) > 0 ? "within" : "beyond";
}

interface RepoActivity {
  edits: number;
  files: Set<string>;
}

interface PeriodStats {
  period: Period;
  aiLines: number;
  youLines: number;
  aiPct: number;
  conceptUse: Map<string, number>;
  buckets: Record<SkillBucket, string[]>;
  unfiledUse: Map<string, number>;
  repoActivity: Map<string, RepoActivity>;
  cleanDays: number;
}

function computePeriod(
  events: MirrorEvent[],
  cache: ClassifyCache,
  ledger: Ledger,
  period: Period,
  baselineProjects: string[],
  projectFilter?: string
): PeriodStats {
  const inPeriod = events.filter((e) => {
    const t = new Date(e.ts);
    const inWindow = t >= period.start && t <= period.end;
    const inProject = projectFilter ? normalizePath(e.project) === projectFilter : true;
    return inWindow && inProject;
  });

  const aiEvents = inPeriod.filter((e) => e.author === "ai");
  const aiLines = aiEvents.reduce((s, e) => s + e.lines, 0);

  // Git baseline over EVERY known repo (all-time event projects + configured
  // extras) — not just repos with AI events this period, otherwise a period of
  // purely hand-written commits is invisible.
  const projects = projectFilter ? [projectFilter] : baselineProjects;
  const totalGitLines = projects.reduce(
    (sum, repo) => sum + gitTotalLinesAdded(repo, period.start.toISOString(), period.end.toISOString()),
    0
  );
  const youLines = Math.max(0, totalGitLines - aiLines);
  const total = aiLines + youLines;

  const conceptUse = new Map<string, number>();
  const unfiledUse = new Map<string, number>();
  const beyondDays = new Set<string>();
  const activeDays = new Set<string>();
  const repoActivity = new Map<string, RepoActivity>();

  for (const e of aiEvents) {
    const day = e.ts.slice(0, 10);
    activeDays.add(day);
    const repo = normalizePath(e.project);
    const activity = repoActivity.get(repo) ?? { edits: 0, files: new Set<string>() };
    activity.edits++;
    activity.files.add(e.file);
    repoActivity.set(repo, activity);
    for (const concept of cache[e.code_hash]?.concepts ?? []) {
      conceptUse.set(concept, (conceptUse.get(concept) ?? 0) + 1);
      if (bucketOf(ledger, concept) === "beyond") beyondDays.add(day);
    }
    for (const name of cache[e.code_hash]?.suggested ?? []) {
      unfiledUse.set(name, (unfiledUse.get(name) ?? 0) + 1);
    }
  }

  const buckets: Record<SkillBucket, string[]> = { within: [], beyond: [], claimed: [] };
  for (const concept of conceptUse.keys()) {
    buckets[bucketOf(ledger, concept)].push(concept);
  }

  return {
    period,
    aiLines,
    youLines,
    aiPct: total === 0 ? 0 : Math.round((aiLines / total) * 100),
    conceptUse,
    buckets,
    unfiledUse,
    repoActivity,
    cleanDays: activeDays.size - beyondDays.size,
  };
}

function aiPctColored(pct: number): string {
  const s = `${pct}% AI-written`;
  return pct >= 60 ? c.red(s) : pct >= 30 ? c.yellow(s) : c.green(s);
}

// Bare-word period aliases ("today" reads more naturally than "--day") that
// get normalized to their flag form before the real parsing below runs.
// Positional args are otherwise treated as a project-path filter, so leaving
// these unrecognized would silently zero out the report instead of erroring.
const BARE_PERIOD_ALIASES: Record<string, PeriodUnit> = {
  today: "day",
  day: "day",
  week: "week",
  month: "month",
  year: "year",
};

export async function reportCommand(rawArgs: string[]): Promise<void> {
  const args = rawArgs.map((a) => {
    const alias = BARE_PERIOD_ALIASES[a];
    return alias ? `--${alias}` : a;
  });

  const json = args.includes("--json");
  const showFiles = args.includes("--files");

  // Period: --day/--week/--month/--year, offset via --back N.
  // Back-compat: `--week N` still means N weeks back.
  let unit: PeriodUnit = "week";
  for (const u of ["day", "week", "month", "year"] as const) {
    if (args.includes(`--${u}`)) unit = u;
  }
  const backIdx = args.indexOf("--back");
  const unitIdx = args.indexOf(`--${unit}`);
  const unitArg = unitIdx >= 0 ? Number(args[unitIdx + 1]) : NaN;
  const back = backIdx >= 0 ? Number(args[backIdx + 1]) || 0 : Number.isInteger(unitArg) ? unitArg : 0;

  const consumed = new Set<number>();
  args.forEach((a, i) => {
    if (a.startsWith("--")) {
      consumed.add(i);
      if ((a === "--back" || a === `--${unit}`) && Number.isInteger(Number(args[i + 1]))) consumed.add(i + 1);
    }
  });
  const positional = args.filter((_, i) => !consumed.has(i));
  const projectFilter = positional[0] ? normalizePath(positional[0]) : undefined;

  const paths = dataPaths();
  const config = loadConfig();
  const events = readEvents(paths.events);
  const vault = loadVaultConcepts();

  // Lazy work happens here: credit recent hand-written commits, then classify
  // anything uncached, then mirror U from the vault.
  const sync = await syncHandwritten(30).catch(() => null);
  const { cache } = await classifyAll(
    paths.cache,
    events.map((e) => ({ code_hash: e.code_hash, snippet: e.snippet, lang: e.lang })),
    vault.map((v) => v.title)
  );
  const ledger = loadLedger(paths.skills);
  syncUnderstanding(ledger, vault);
  saveLedger(paths.skills, ledger);

  const baselineProjects = [
    ...new Set([
      ...events.map((e) => normalizePath(e.project)),
      ...(config.projects ?? []).map(normalizePath),
    ]),
  ];

  const current = computePeriod(events, cache, ledger, periodRange(unit, back), baselineProjects, projectFilter);
  const trend = [1, 2, 3].map((n) =>
    computePeriod(events, cache, ledger, periodRange(unit, back + n), baselineProjects, projectFilter)
  );

  const decayAlerts = Object.entries(ledger.concepts)
    .map(([name, entry]) => ({ name, days: daysUntilDecay(entry) }))
    .filter((a): a is { name: string; days: number } => a.days !== null && a.days <= 7)
    .sort((a, b) => a.days - b.days);

  // Overrides in this period: shipped-anyway moments, counted per concept.
  const overrideCounts = new Map<string, number>();
  for (const o of readOverrides(paths.overrides)) {
    const t = new Date(o.ts);
    if (t < current.period.start || t > current.period.end) continue;
    if (projectFilter && normalizePath(o.project) !== projectFilter) continue;
    overrideCounts.set(o.concept, (overrideCounts.get(o.concept) ?? 0) + 1);
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          period: { unit, start: iso(current.period.start), end: iso(current.period.end) },
          project: projectFilter ?? null,
          lines: { you: current.youLines, ai: current.aiLines, ai_pct: current.aiPct },
          concepts: Object.fromEntries(current.conceptUse),
          buckets: current.buckets,
          unfiled: Object.fromEntries(current.unfiledUse),
          clean_days: current.cleanDays,
          repos: Object.fromEntries(
            [...current.repoActivity].map(([repo, a]) => [repo, { edits: a.edits, files: a.files.size }])
          ),
          trend: trend.map((w) => ({
            start: iso(w.period.start),
            ai_pct: w.aiPct,
            beyond: w.buckets.beyond.length,
          })),
          decay_alerts: decayAlerts,
          overrides: Object.fromEntries(overrideCounts),
          synced: sync ? { evidence: sync.evidence, samples: sync.samples } : null,
        },
        null,
        2
      )
    );
    return;
  }

  const label = projectFilter ?? "all projects";
  console.log("");
  console.log(c.bold(c.cyan(`AI Mirror — ${periodLabel(unit, current.period)}`)) + c.dim(`  [${label}]`));
  console.log(c.dim("─".repeat(56)));

  const total = current.aiLines + current.youLines;
  console.log(`Code shipped   ${c.bold(String(total))} lines`);
  console.log(
    `  ${splitBar(current.aiPct)}  ${c.green(`you ${current.youLines}`)} · ${c.red(`AI ${current.aiLines}`)} → ${aiPctColored(current.aiPct)}`
  );
  if (sync && (sync.evidence > 0 || sync.samples > 0)) {
    console.log(c.dim(`  (auto-synced commits: +${sync.evidence} P evidence, +${sync.samples} style samples)`));
  }

  if (current.conceptUse.size > 0) {
    console.log(`\n${c.bold("Concepts the AI handled for you")}`);
    console.log(`   ${c.green("✓")} within your skill    ${c.bold(String(current.buckets.within.length))}`);
    console.log(`   ${c.red("⚠")} beyond your skill    ${c.bold(String(current.buckets.beyond.length))}`);
    if (current.buckets.claimed.length > 0) {
      console.log(`   ${c.yellow("⚠")} claimed-only skill   ${c.bold(String(current.buckets.claimed.length))}`);
    }
    const beyondSorted = current.buckets.beyond.sort(
      (a, b) => (current.conceptUse.get(b) ?? 0) - (current.conceptUse.get(a) ?? 0)
    );
    for (const concept of beyondSorted.slice(0, 8)) {
      console.log(c.red(`        · ${concept.padEnd(34)} used ${current.conceptUse.get(concept)}×`));
    }
  } else if (current.aiLines > 0) {
    console.log(
      c.dim(
        process.env["ANTHROPIC_API_KEY"]
          ? `\n(no vault concepts detected in this period)`
          : `\n(no vault concepts mapped — add an ANTHROPIC_API_KEY and re-run \`mirror\`)`
      )
    );
  }

  if (current.unfiledUse.size > 0) {
    console.log(`\n${c.bold("Unfiled")} ${c.dim("— AI used these, your vault has no note (untracked)")}`);
    const sorted = [...current.unfiledUse.entries()].sort((a, b) => b[1] - a[1]);
    for (const [name, n] of sorted.slice(0, 6)) {
      console.log(`   ${c.yellow("✚")} ${name.padEnd(36)} ${n}×`);
    }
    console.log(c.dim(`   → \`mirror gaps\` or /gaps to triage`));
  }

  console.log(`\nDays shipping only within your skill: ${c.bold(String(current.cleanDays))} 🔥`);
  console.log(c.dim(`\nPast ${unit}s:`));
  for (const w of trend) {
    console.log(
      `   ${shortLabel(unit, w.period).padEnd(9)} ${splitBar(w.aiPct, 16)}  ${aiPctColored(w.aiPct)}, ${w.buckets.beyond.length} beyond`
    );
  }

  if (overrideCounts.size > 0) {
    console.log(`\n${c.bold("Overrides")} ${c.dim("— you shipped beyond your P anyway (witnessed, not judged)")}`);
    const sorted = [...overrideCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [concept, n] of sorted) {
      console.log(`   ${c.red("⚑")} ${concept.padEnd(36)} ${n}×  ${c.dim(`→ /drill ${concept}`)}`);
    }
  }

  if (decayAlerts.length > 0) {
    console.log(`\n${c.bold("Decay alerts")}`);
    for (const a of decayAlerts) {
      console.log(`   ${c.yellow("⏳")} ${a.name.padEnd(36)} P drops in ${a.days} day(s)`);
    }
  }

  if (current.repoActivity.size > 0) {
    console.log(`\n${c.bold("Where the AI worked")}`);
    const repos = [...current.repoActivity.entries()].sort((a, b) => b[1].edits - a[1].edits);
    for (const [repo, a] of repos) {
      console.log(`   ${c.cyan(repo.padEnd(40))} ${a.edits} edit(s) · ${a.files.size} file(s)`);
      if (showFiles) {
        for (const f of a.files) console.log(c.dim(`      ${f}`));
      }
    }
    if (!showFiles) console.log(c.dim(`   (add --files for the full file list)`));
  }

  console.log(
    c.dim(
      `\nyou-lines = git lines added − AI lines; AI rewrites double-count and\nuncommitted AI edits skew the split — treat the ratio as a trend, not truth.\n`
    )
  );
}
