import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";

const CONFIG_PATH = resolve(import.meta.dir, "mirror.config.json");
const config = existsSync(CONFIG_PATH)
  ? (JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as { data_dir: string })
  : { data_dir: resolve(import.meta.dir, "data") };
const LOG_PATH = resolve(config.data_dir, "events.jsonl");

interface Event {
  ts: string;
  author: "ai" | "you";
  tool: string;
  file: string;
  project: string;
  lines: number;
  concepts?: string[];
}

function loadEvents(): Event[] {
  if (!existsSync(LOG_PATH)) return [];
  return readFileSync(LOG_PATH, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Event);
}

function weekRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

function gitTotalLinesAdded(repoPath: string, since: string, until: string): number {
  try {
    const out = execSync(
      `git log --since="${since}" --until="${until}" --pretty=tformat: --numstat`,
      { cwd: repoPath, encoding: "utf8" }
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

function report() {
  const events = loadEvents();
  const { start, end } = weekRange();
  const projectFilter = process.argv[2]; // optional: filter by project path

  const week = events.filter((e) => {
    const t = new Date(e.ts);
    const inWeek = t >= start && t <= end;
    const inProject = projectFilter ? e.project === projectFilter : true;
    return inWeek && inProject;
  });

  const aiEvents = week.filter((e) => e.author === "ai");
  const aiLines = aiEvents.reduce((s, e) => s + e.lines, 0);

  // For git line count, use current working directory or project filter
  const repoPath = projectFilter ?? process.cwd();
  const totalGitLines = gitTotalLinesAdded(repoPath, start.toISOString(), end.toISOString());
  const youLines = Math.max(0, totalGitLines - aiLines);
  const total = aiLines + youLines;
  const aiPct = total === 0 ? 0 : Math.round((aiLines / total) * 100);

  const conceptCounts = new Map<string, number>();
  for (const e of aiEvents) {
    for (const concept of e.concepts ?? []) {
      conceptCounts.set(concept, (conceptCounts.get(concept) ?? 0) + 1);
    }
  }

  const aiFiles = new Set(aiEvents.map((e) => e.file));

  const label = projectFilter ?? "all projects";
  console.log(`\nAI Mirror — week of ${fmt(start)} → ${fmt(end)}  [${label}]`);
  console.log("─".repeat(50));
  console.log(`Code shipped:        ${total} lines`);
  console.log(`  you: ${youLines}  ·  AI: ${aiLines}  →  ${aiPct}% AI-written`);

  if (conceptCounts.size > 0) {
    console.log(`\nConcepts the AI handled for you:`);
    const sorted = [...conceptCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [concept, count] of sorted) {
      console.log(`   · ${concept.padEnd(28)} ${count}×`);
    }
  }

  console.log(`\nFiles AI touched (${aiFiles.size}):`);
  for (const f of aiFiles) {
    const count = aiEvents.filter((e) => e.file === f).length;
    console.log(`   ${count}×  ${f}`);
  }
  console.log();
}

report();
