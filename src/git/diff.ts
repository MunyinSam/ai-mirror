// Git plumbing for attribution — replaces the old hand-rolled multi-commit
// state machine (handwritten.ts) with a per-commit parser. Pure parsing is
// separated from the shell-out so it's testable without a real git repo.
import { execSync } from "node:child_process";

/** Parse `git show --format= -p -U0 -M <sha>` output into added lines per
 *  file. -U0 (zero context lines) means every "+" line under a file's
 *  "+++ b/<path>" header is a genuinely added line, not surrounding context
 *  — no hunk-boundary bookkeeping needed. -M (rename detection) means a pure
 *  rename produces no +/- lines at all, so renamed-but-unchanged files
 *  correctly contribute nothing to either side of the attribution. */
export function parseAddedLines(diffOutput: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  let file: string | null = null;

  for (const line of diffOutput.split("\n")) {
    if (line.startsWith("+++ b/")) {
      file = line.slice("+++ b/".length);
    } else if (line.startsWith("+++ ")) {
      file = null; // "+++ /dev/null" — file was deleted, nothing added to it
    } else if (file && line.startsWith("+") && !line.startsWith("+++")) {
      const arr = result.get(file) ?? [];
      arr.push(line.slice(1));
      result.set(file, arr);
    }
  }
  //   Result Example:
  //   Map {
  //   "src/foo.ts" => ["import x from 'y'", "const z = 1", ...],
  //   "src/bar.ts" => ["export function baz() {}"]
  // }

  return result;
}

/** Added lines per file for one commit, keyed by path relative to repo root.
 *  Returns an empty map (never throws) if the sha is bad or repo isn't git —
 *  attribution should degrade to "nothing attributable," not crash a batch run. */
export function getCommitAddedLines(repo: string, sha: string): Map<string, string[]> {
  try {
    const out = execSync(`git show --format= -p -U0 --no-color -M ${sha}`, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return parseAddedLines(out);
  } catch {
    return new Map();
  }
}

export interface CommitMeta {
  sha: string;
  ts: string;
  authorEmail: string;
  subject: string;
}

/** Commits touching this repo since `sinceIso`, oldest first — the driver
 *  for backfilling the `commits` table (stage 5). */
export function listCommitsSince(repo: string, sinceIso: string): CommitMeta[] {
  try {
    const out = execSync(
      `git log --no-merges --since="${sinceIso}" --reverse --format=COMMIT%x09%H%x09%cI%x09%ae%x09%s`,
      { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    return out
      .split("\n")
      .filter((l) => l.startsWith("COMMIT\t"))
      .map((l) => {
        const [, sha, ts, authorEmail, ...rest] = l.split("\t");
        return { sha: sha!, ts: ts!, authorEmail: authorEmail!, subject: rest.join("\t") };
      });
  } catch {
    return [];
  }
}
