// One-time adapter: the old event shape (ts, tool, file, project, lang,
// lines, code_hash, snippet — no before/after split) into the new `events`
// schema. Used to backfill the 411 events stranded in ~/.ai-mirror/queue.jsonl
// (written by the old Prod/ai-mirror hook before it broke) and the 29 in
// ~/.skillgate/data/events.jsonl (the original v1 data dir).
//
// Both sources only ever recorded `snippet` (== after_text, capped at the old
// 8KB limit) with no `before_text`, so line counts here are approximate — but
// that's fine: this table's added_lines/removed_lines are bookkeeping only.
// Real attribution (attributeCommit) derives its counts from git, not from
// this column, so legacy imprecision here never touches the headline number.
import { readFileSync } from "node:fs";
import type { Sql } from "../db/client.ts";
import { normalizePath, sha256 } from "../util.ts";

const LEGACY_SNIPPET_CAP = 8 * 1024;

interface LegacyEvent {
  ts: string;
  tool: string;
  file: string;
  project: string;
  lang: string;
  lines: number;
  code_hash: string;
  snippet: string;
}

export interface ImportResult {
  inserted: number;
  skipped: number;
}

/** Read one legacy JSONL file and insert its events idempotently. Safe to
 *  call on a file that doesn't exist (returns zero) or run twice (the same
 *  ON CONFLICT (event_uid) DO NOTHING guarantee as drainQueueFile). */
export async function importLegacyFile(sql: Sql, path: string): Promise<ImportResult> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { inserted: 0, skipped: 0 };
  }

  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const rows = lines.map((line) => {
    const e: LegacyEvent = JSON.parse(line);
    const repo = normalizePath(e.project);
    const file = normalizePath(e.file);
    return {
      event_uid: sha256(`${e.ts}|${file}|${e.code_hash}`),
      ts: e.ts,
      tool: e.tool,
      session_id: null,
      repo,
      file,
      lang: e.lang,
      code_hash: e.code_hash,
      before_text: null,
      after_text: e.snippet,
      added_lines: e.lines,
      removed_lines: 0,
      truncated: e.snippet.length >= LEGACY_SNIPPET_CAP,
    };
  });

  if (rows.length === 0) return { inserted: 0, skipped: 0 };

  const result = await sql`
    INSERT INTO events ${sql(rows)}
    ON CONFLICT (event_uid) DO NOTHING
  `;
  return { inserted: result.count, skipped: rows.length - result.count };
}
