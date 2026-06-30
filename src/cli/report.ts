import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";

const LOG_PATH = resolve(import.meta.dir, "../../.skillgate/data/events.jsonl");
const REPO_ROOT = resolve(import.meta.dir, "../../");

interface Event {
  ts: string;
  author: "ai" | "you";
  tool: string;
  file: string;
  lines: number;
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
  const day = now.getDay();
  const start = new Date(now);
  start.setDate(now.getDate() - day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

function gitTotalLinesAdded(since: string, until: string): number {
  try {
    const out = execSync(
      `git log --since="${since}" --until="${until}" --pretty=tformat: --numstat`,
      { cwd: REPO_ROOT, encoding: "utf8" }
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

  const week = events.filter((e) => {
    const t = new Date(e.ts);
    return t >= start && t <= end;
  });

  const aiLines = week
    .filter((e) => e.author === "ai")
    .reduce((s, e) => s + e.lines, 0);

  const totalGitLines = gitTotalLinesAdded(
    start.toISOString(),
    end.toISOString()
  );

  const youLines = Math.max(0, totalGitLines - aiLines);
  const total = aiLines + youLines;
  const aiPct = total === 0 ? 0 : Math.round((aiLines / total) * 100);

  const aiFiles = new Set(
    week.filter((e) => e.author === "ai").map((e) => e.file)
  );

  console.log(`\nAI Mirror — week of ${fmt(start)} → ${fmt(end)}`);
  console.log("─".repeat(42));
  console.log(`Code shipped:        ${total} lines`);
  console.log(`  you: ${youLines}  ·  AI: ${aiLines}  →  ${aiPct}% AI-written`);
  console.log(`\nFiles AI touched (${aiFiles.size}):`);
  for (const f of aiFiles) {
    const count = week.filter((e) => e.author === "ai" && e.file === f).length;
    console.log(`   ${count}×  ${f}`);
  }
  console.log();
}

report();
