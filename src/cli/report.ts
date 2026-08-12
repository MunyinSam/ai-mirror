// `mirror report` — renders what buildReport() assembled. All the actual
// querying lives in src/report/build.ts; this file is arg parsing + text
// formatting only.
import { db } from "../db/client.ts";
import type { PeriodUnit } from "../domain/period.ts";
import { buildReport, type ReportData } from "../report/build.ts";
import { c, splitBar } from "./colors.ts";

const BARE_PERIOD_ALIASES: Record<string, PeriodUnit> = {
  today: "day",
  day: "day",
  week: "week",
  month: "month",
  year: "year",
};

function parseArgs(rawArgs: string[]): { unit: PeriodUnit; back: number; repo?: string; json: boolean } {
  const args = rawArgs.map((a) => {
    const alias = BARE_PERIOD_ALIASES[a];
    return alias ? `--${alias}` : a;
  });

  const json = args.includes("--json");

  let unit: PeriodUnit = "week";
  for (const u of ["day", "week", "month", "year"] as const) {
    if (args.includes(`--${u}`)) unit = u;
  }

  const backIdx = args.indexOf("--back");
  const back = backIdx >= 0 ? Number(args[backIdx + 1]) || 0 : 0;

  const consumed = new Set<number>();
  args.forEach((a, i) => {
    if (a.startsWith("--")) {
      consumed.add(i);
      if (a === "--back") consumed.add(i + 1);
    }
  });
  const positional = args.filter((_, i) => !consumed.has(i));

  return { unit, back, repo: positional[0], json };
}

function aiPctColored(pct: number): string {
  const s = `${pct}% AI-written`;
  return pct >= 60 ? c.red(s) : pct >= 30 ? c.yellow(s) : c.green(s);
}

function printText(unit: PeriodUnit, data: ReportData): void {
  const label = data.repo ?? "all projects";

  console.log("");
  console.log(c.bold(c.cyan(`AI Mirror — ${data.period.start} → ${data.period.end}`)) + c.dim(`  [${label}]`));
  console.log(c.dim("─".repeat(56)));

  const total = data.lines.ai + data.lines.human;
  console.log(`Code shipped   ${c.bold(String(total))} lines`);
  console.log(
    `  ${splitBar(data.lines.ai_pct)}  ${c.green(`you ${data.lines.human}`)} · ${c.red(`AI ${data.lines.ai}`)} → ${aiPctColored(data.lines.ai_pct)}`
  );

  if (data.concepts.length > 0) {
    const within = data.concepts.filter((x) => x.bucket === "within");
    const beyond = data.concepts.filter((x) => x.bucket === "beyond");
    const claimed = data.concepts.filter((x) => x.bucket === "claimed");
    console.log(`\n${c.bold("Concepts the AI handled for you")}`);
    console.log(`   ${c.green("✓")} within your skill    ${c.bold(String(within.length))}`);
    console.log(`   ${c.red("⚠")} beyond your skill    ${c.bold(String(beyond.length))}`);
    if (claimed.length > 0) {
      console.log(`   ${c.yellow("⚠")} claimed-only skill   ${c.bold(String(claimed.length))}`);
    }
    for (const x of beyond.slice(0, 8)) {
      console.log(c.red(`        · ${x.concept.padEnd(34)} used ${x.uses}×`));
    }
  } else if (data.lines.ai > 0) {
    console.log(c.dim(`\n(no classified concepts yet for this period — run \`mirror classify\`)`));
  }

  if (data.unfiled.length > 0) {
    console.log(`\n${c.bold("Unfiled")} ${c.dim("— AI used these, your vault has no note (untracked)")}`);
    for (const { concept, uses } of data.unfiled.slice(0, 6)) {
      console.log(`   ${c.yellow("✚")} ${concept.padEnd(36)} ${uses}×`);
    }
    console.log(c.dim(`   → \`mirror gaps\` to triage`));
  }

  console.log(c.dim(`\nPast ${unit}s:`));
  for (const t of data.trend) {
    console.log(
      `   ${t.start.padEnd(11)} ${splitBar(t.ai_pct, 16)}  ${aiPctColored(t.ai_pct)}, ${t.beyond} beyond`
    );
  }

  if (data.decay_alerts.length > 0) {
    console.log(`\n${c.bold("Decay alerts")}`);
    for (const a of data.decay_alerts) {
      console.log(`   ${c.yellow("⏳")} ${a.concept.padEnd(36)} P drops in ${a.days} day(s)`);
    }
  }

  if (data.repos.length > 0) {
    console.log(`\n${c.bold("Where it happened")}`);
    for (const r of data.repos) {
      console.log(`   ${c.cyan(r.repo.padEnd(40))} ${r.commits} commit(s) · ${r.files} file(s)`);
    }
  }

  console.log(
    c.dim(
      `\nai/human lines come from real per-commit git diffs (attributions table),\nnot a subtraction — see docs/algorithm.md for the matching rule and its limits.\n`
    )
  );
}

export async function reportCommand(rawArgs: string[]): Promise<void> {
  const { unit, back, repo, json } = parseArgs(rawArgs);
  const data = await buildReport(db(), { unit, back, repo });

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  printText(unit, data);
}
