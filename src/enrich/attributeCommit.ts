// Orchestration: git + DB glue around the pure matching logic in attribute.ts.
// Deliberately separated from attribute.ts — markAiLines/normalizeKey/
// coalesceRuns have zero I/O and are trivially unit-testable; everything
// here needs a real repo and a real database, so it's tested with golden
// fixtures instead (tests/attributeCommit.test.ts).
import type { Sql } from "../db/client.ts";
import { getCommitAddedLines } from "../git/diff.ts";
import { CODE_LANGS, isExcludedPath } from "../types.ts";
import { langOf } from "../util.ts";
import { markAiLines } from "./attribute.ts";

/** Get Commits from specific TS and repo*/
async function previousCommitTs(sql: Sql, repo: string, beforeTs: string): Promise<string> {
  const rows = await sql<{ ts: string }[]>`
    SELECT ts FROM commits
    WHERE repo = ${repo} AND ts < ${beforeTs}
    ORDER BY ts DESC LIMIT 1
  `;
  return rows[0]?.ts ?? "1970-01-01T00:00:00.000Z";
}

/** Attribute one commit: for each file it touched, decide how many of its
 *  added lines are AI's, and upsert the result. Idempotent — re-running on
 *  an already-attributed commit just recomputes and overwrites (ON CONFLICT
 *  DO UPDATE), which is what makes re-attributing under a new `runMin` or a
 *  smarter matching algorithm later a safe, resumable operation. */
export async function attributeCommit(sql: Sql, repo: string, sha: string): Promise<void> {
  const [commit] = await sql<{ id: number; ts: string }[]>`
    SELECT id, ts FROM commits WHERE repo = ${repo} AND sha = ${sha}
  `;
  if (!commit) throw new Error(`commit not found: ${repo}@${sha} (insert into commits first)`);

  const addedByFile = getCommitAddedLines(repo, sha);
  const prevTs = await previousCommitTs(sql, repo, commit.ts);

  for (const [file, addedLines] of addedByFile) {
    if (isExcludedPath(file) || !CODE_LANGS.has(langOf(file))) continue;
    if (addedLines.length === 0) continue;

    const candidates = await sql<{ after_text: string }[]>`
      SELECT after_text FROM events
      WHERE repo = ${repo} AND file = ${repo + "/" + file}
        AND ts > ${prevTs} AND ts <= ${commit.ts}
    `;

    const { aiLines } = markAiLines(
      addedLines,
      candidates.map((c) => c.after_text)
    );

    await sql`
      INSERT INTO attributions (commit_id, file, lang, added_lines, ai_lines, candidate_events)
      VALUES (${commit.id}, ${file}, ${langOf(file)}, ${addedLines.length}, ${aiLines}, ${candidates.length})
      ON CONFLICT (commit_id, file) DO UPDATE SET
        added_lines = EXCLUDED.added_lines,
        ai_lines = EXCLUDED.ai_lines,
        candidate_events = EXCLUDED.candidate_events
    `;
  }

  await sql`UPDATE commits SET attributed_at = now() WHERE id = ${commit.id}`;
}
