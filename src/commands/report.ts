// Report v2 (PLAN Phase 5): the weekly mirror, with the ledger behind it.
// Buckets every concept the AI handled into within / beyond / claimed-only
// skill, using effective (decayed) P.
import { execSync } from "node:child_process";
import { dataPaths } from "../config.ts";
import { classifyAll } from "../classifier.ts";
import { daysUntilDecay, effectiveP, isClaimedOnly, loadLedger, saveLedger, syncUnderstanding } from "../ledger.ts";
import { readEvents } from "../log.ts";
import type { ClassifyCache, Ledger, MirrorEvent } from "../types.ts";
import { normalizePath } from "../util.ts";
import { loadVaultConcepts } from "../vault.ts";

interface WeekWindow {
  start: Date;
  end: Date;
}

/** Week window (Sun–Sat), `offset` weeks back from the current one. */
export function weekRange(offset = 0, now = new Date()): WeekWindow {
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay() - offset * 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
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

interface WeekStats {
  window: WeekWindow;
  aiLines: number;
  youLines: number;
  aiPct: number;
  conceptUse: Map<string, number>; // concept → AI usage count
  buckets: Record<SkillBucket, string[]>;
  aiFiles: Map<string, number>;
  cleanDays: number; // days with AI events, none beyond skill
}

function computeWeek(
  events: MirrorEvent[],
  cache: ClassifyCache,
  ledger: Ledger,
  window: WeekWindow,
  projectFilter?: string
): WeekStats {
  const week = events.filter((e) => {
    const t = new Date(e.ts);
    const inWeek = t >= window.start && t <= window.end;
    const inProject = projectFilter ? normalizePath(e.project) === projectFilter : true;
    return inWeek && inProject;
  });

  const aiEvents = week.filter((e) => e.author === "ai");
  const aiLines = aiEvents.reduce((s, e) => s + e.lines, 0);

  // Git baseline computed per-project from the log — same answer from any cwd.
  const projects = projectFilter
    ? [projectFilter]
    : [...new Set(week.map((e) => normalizePath(e.project)))];
  const totalGitLines = projects.reduce(
    (sum, repo) => sum + gitTotalLinesAdded(repo, window.start.toISOString(), window.end.toISOString()),
    0
  );
  const youLines = Math.max(0, totalGitLines - aiLines);
  const total = aiLines + youLines;

  const conceptUse = new Map<string, number>();
  const beyondDays = new Set<string>();
  const activeDays = new Set<string>();
  const aiFiles = new Map<string, number>();

  for (const e of aiEvents) {
    const day = e.ts.slice(0, 10);
    activeDays.add(day);
    aiFiles.set(e.file, (aiFiles.get(e.file) ?? 0) + 1);
    for (const concept of cache[e.code_hash]?.concepts ?? []) {
      conceptUse.set(concept, (conceptUse.get(concept) ?? 0) + 1);
      if (bucketOf(ledger, concept) === "beyond") beyondDays.add(day);
    }
  }

  const buckets: Record<SkillBucket, string[]> = { within: [], beyond: [], claimed: [] };
  for (const concept of conceptUse.keys()) {
    buckets[bucketOf(ledger, concept)].push(concept);
  }

  return {
    window,
    aiLines,
    youLines,
    aiPct: total === 0 ? 0 : Math.round((aiLines / total) * 100),
    conceptUse,
    buckets,
    aiFiles,
    cleanDays: activeDays.size - beyondDays.size,
  };
}

const fmt = (d: Date) => d.toISOString().slice(0, 10);

export async function reportCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const weekIdx = args.indexOf("--week");
  const offset = weekIdx >= 0 ? Number(args[weekIdx + 1]) || 0 : 0;
  const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--week");
  const projectFilter = positional[0] ? normalizePath(positional[0]) : undefined;

  const paths = dataPaths();
  const events = readEvents(paths.events);
  const vault = loadVaultConcepts();

  // Classify anything uncached, sync U — the report is where lazy work happens.
  const { cache } = await classifyAll(
    paths.cache,
    events.map((e) => ({ code_hash: e.code_hash, snippet: e.snippet, lang: e.lang })),
    vault.map((v) => v.title)
  );
  const ledger = loadLedger(paths.skills);
  syncUnderstanding(ledger, vault);
  saveLedger(paths.skills, ledger);

  const current = computeWeek(events, cache, ledger, weekRange(offset), projectFilter);
  const trend = [1, 2, 3].map((back) =>
    computeWeek(events, cache, ledger, weekRange(offset + back), projectFilter)
  );

  const decayAlerts = Object.entries(ledger.concepts)
    .map(([name, entry]) => ({ name, days: daysUntilDecay(entry) }))
    .filter((a): a is { name: string; days: number } => a.days !== null && a.days <= 7)
    .sort((a, b) => a.days - b.days);

  if (json) {
    console.log(
      JSON.stringify(
        {
          week: { start: fmt(current.window.start), end: fmt(current.window.end) },
          project: projectFilter ?? null,
          lines: { you: current.youLines, ai: current.aiLines, ai_pct: current.aiPct },
          concepts: Object.fromEntries(current.conceptUse),
          buckets: current.buckets,
          clean_days: current.cleanDays,
          trend: trend.map((w) => ({
            start: fmt(w.window.start),
            ai_pct: w.aiPct,
            beyond: w.buckets.beyond.length,
          })),
          decay_alerts: decayAlerts,
        },
        null,
        2
      )
    );
    return;
  }

  const label = projectFilter ?? "all projects";
  console.log(`\nAI Mirror — week of ${fmt(current.window.start)} → ${fmt(current.window.end)}  [${label}]`);
  console.log("─".repeat(56));
  console.log(`Code shipped:        ${current.aiLines + current.youLines} lines`);
  console.log(`  you: ${current.youLines}  ·  AI: ${current.aiLines}  →  ${current.aiPct}% AI-written`);

  if (current.conceptUse.size > 0) {
    console.log(`\nConcepts the AI handled for you:`);
    console.log(`   ✓ within your skill:   ${current.buckets.within.length}`);
    console.log(`   ⚠ beyond your skill:   ${current.buckets.beyond.length}`);
    if (current.buckets.claimed.length > 0) {
      console.log(`   ⚠ claimed-only skill:  ${current.buckets.claimed.length}`);
    }
    for (const concept of current.buckets.beyond.sort(
      (a, b) => (current.conceptUse.get(b) ?? 0) - (current.conceptUse.get(a) ?? 0)
    )) {
      console.log(`        · ${concept.padEnd(32)} used ${current.conceptUse.get(concept)}×`);
    }
  } else if (current.aiLines > 0) {
    console.log(`\n(no vault concepts mapped — add an ANTHROPIC_API_KEY and run \`mirror classify\`)`);
  }

  console.log(`\nDays shipping only within your skill: ${current.cleanDays} 🔥`);

  const trendLine = trend
    .map((w) => `${fmt(w.window.start).slice(5)}: ${w.aiPct}% AI, ${w.buckets.beyond.length} beyond`)
    .join("  ·  ");
  console.log(`Past weeks: ${trendLine}`);

  if (decayAlerts.length > 0) {
    console.log(`\nDecay alerts:`);
    for (const a of decayAlerts) console.log(`   ⏳ ${a.name} — P drops in ${a.days} day(s)`);
  }

  if (current.aiFiles.size > 0) {
    console.log(`\nFiles AI touched (${current.aiFiles.size}):`);
    for (const [f, n] of current.aiFiles) console.log(`   ${n}×  ${f}`);
  }

  console.log(
    `\n(you-lines = git lines added − AI lines; AI rewrites double-count and\n uncommitted AI edits skew the split — treat the ratio as a trend, not truth)\n`
  );
}
