// P-inference pipeline (CONCEPTS §5, PLAN Phase 3): committed code with no
// matching AI event is provably yours. This is a heuristic, not proof — the
// formal no-AI challenges (v2) are the airtight version.
//
// One pipeline, two consumers: surviving hunks become P evidence (via the
// classifier) AND style-corpus samples.
import { execSync } from "node:child_process";
import type { MirrorEvent } from "./types.ts";
import { langOf, normalizePath } from "./util.ts";

/** Languages the classifier can parse — everything else is skipped. */
const CODE_LANGS = new Set(["ts", "tsx", "js", "jsx", "py"]);

/** Lines shorter than this after trimming (braces, blanks) carry no authorship
 *  signal and are excluded from matching. */
const MIN_SIGNIFICANT_LEN = 8;

/** A hunk counts as AI-written when at least this share of its significant
 *  lines appears in the AI snippet log. */
const AI_MATCH_THRESHOLD = 0.5;

/** Hunks smaller than this are too thin to classify or learn style from. */
const MIN_HUNK_LINES = 3;

export interface AddedHunk {
  commit: string;
  date: string;
  file: string;
  lines: string[];
}

export function significant(line: string): boolean {
  return line.trim().length >= MIN_SIGNIFICANT_LEN;
}

/** Normalized significant lines from every AI snippet for one project. */
export function buildAiLineSet(events: MirrorEvent[]): Set<string> {
  const set = new Set<string>();
  for (const e of events) {
    for (const line of e.snippet.split("\n")) {
      if (significant(line)) set.add(line.trim());
    }
  }
  return set;
}

/** Parse `git log --format=COMMIT%x09%H%x09%cI -p -U0` output into added-line
 *  hunks. With -U0 each @@ block's + lines form one contiguous hunk. */
export function parseAddedHunks(gitOutput: string): AddedHunk[] {
  const hunks: AddedHunk[] = [];
  let commit = "";
  let date = "";
  let file = "";
  let current: string[] = [];

  const flush = () => {
    if (current.length > 0 && file) {
      hunks.push({ commit, date, file, lines: current });
    }
    current = [];
  };

  for (const line of gitOutput.split("\n")) {
    if (line.startsWith("COMMIT\t")) {
      flush();
      const parts = line.split("\t");
      commit = parts[1] ?? "";
      date = parts[2] ?? "";
      file = "";
    } else if (line.startsWith("+++ b/")) {
      flush();
      file = line.slice("+++ b/".length);
    } else if (line.startsWith("+++ ")) {
      flush();
      file = ""; // deleted file (`+++ /dev/null`)
    } else if (line.startsWith("@@")) {
      flush();
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      current.push(line.slice(1));
    }
  }
  flush();
  return hunks;
}

/** Filter added hunks down to the ones you wrote by hand: code files only,
 *  big enough to mean something, and not matching logged AI snippets. */
export function handwrittenHunks(hunks: AddedHunk[], aiLines: Set<string>): AddedHunk[] {
  return hunks.filter((hunk) => {
    if (!CODE_LANGS.has(langOf(hunk.file))) return false;
    if (hunk.file.includes("node_modules/")) return false;
    if (hunk.lines.length < MIN_HUNK_LINES) return false;
    const sig = hunk.lines.filter(significant).map((l) => l.trim());
    if (sig.length === 0) return false;
    const matched = sig.filter((l) => aiLines.has(l)).length;
    return matched / sig.length < AI_MATCH_THRESHOLD;
  });
}

/** Run the full inference for one repo over the last `days` days. */
export function inferHandwritten(
  repoPath: string,
  days: number,
  projectEvents: MirrorEvent[]
): AddedHunk[] {
  let out: string;
  try {
    out = execSync(
      `git log --no-merges --since="${days} days ago" --format=COMMIT%x09%H%x09%cI -p -U0 --no-color`,
      { cwd: repoPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }
    );
  } catch {
    return []; // not a git repo, or git failed — skip silently
  }
  return handwrittenHunks(parseAddedHunks(out), buildAiLineSet(projectEvents));
}

/** Group repos: events belong to the repo whose normalized project path they carry. */
export function eventsByProject(events: MirrorEvent[]): Map<string, MirrorEvent[]> {
  const map = new Map<string, MirrorEvent[]>();
  for (const e of events) {
    const key = normalizePath(e.project);
    const list = map.get(key) ?? [];
    list.push(e);
    map.set(key, list);
  }
  return map;
}
