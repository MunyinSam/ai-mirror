// Ingest — turns "at-least-once delivery" (a queue file can be drained twice
// if the process dies between insert and delete) into "effectively-once",
// by making the insert idempotent on event_uid.
import { readFileSync } from "node:fs";
import type { Sql } from "../db/client.ts";
import type { QueuedEvent } from "../types.ts";
import { sha256 } from "../util.ts";
import { ackQueueFile } from "./queue.ts";

export interface DrainResult {
  inserted: number;
  skipped: number;
}

/** Natural key, deterministic from content: replaying the same queue file
 *  produces the same uid, so a duplicate insert collides harmlessly instead
 *  of creating a duplicate row. */
export function eventUid(e: QueuedEvent): string {
  return sha256(`${e.ts}|${e.file}|${e.code_hash}`);
}

/** Added/removed line counts between two texts. Bookkeeping only ("how much
 *  changed") — not authorship attribution, which needs a committed diff and
 *  lives in src/enrich/attribute.ts. Uses a signed-count multiset rather than
 *  Set difference so a line that changes frequency (e.g. appears once in
 *  `before`, twice in `after`) is still counted correctly. */
export function diffLineCounts(
  before: string | null,
  after: string
): { added: number; removed: number } {
  const beforeLines = before == null ? [] : before.split("\n");
  const afterLines = after.split("\n");

  const counts = new Map<string, number>();
  for (const line of beforeLines) counts.set(line, (counts.get(line) ?? 0) - 1);
  for (const line of afterLines) counts.set(line, (counts.get(line) ?? 0) + 1);

  let added = 0;
  let removed = 0;
  for (const delta of counts.values()) {
    if (delta > 0) added += delta;
    else removed += -delta;
  }
  return { added, removed };
}

/** Read one claimed queue file, insert every event idempotently, then delete
 *  the file. Ack only happens after the insert commits — if the process dies
 *  mid-drain, the file is left un-acked and safely replayed next run. */
export async function drainQueueFile(sql: Sql, claimedPath: string): Promise<DrainResult> {
  const raw = readFileSync(claimedPath, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);

  const rows = lines.map((line) => {
    const e: QueuedEvent = JSON.parse(line);
    const { added, removed } = diffLineCounts(e.before_text, e.after_text);
    return {
      event_uid: eventUid(e),
      ts: e.ts,
      tool: e.tool,
      session_id: e.session_id ?? null,
      repo: e.repo,
      file: e.file,
      lang: e.lang,
      code_hash: e.code_hash,
      before_text: e.before_text,
      after_text: e.after_text,
      added_lines: added,
      removed_lines: removed,
      truncated: e.truncated,
    };
  });

  if (rows.length === 0) {
    ackQueueFile(claimedPath);
    return { inserted: 0, skipped: 0 };
  }

  // ON CONFLICT DO NOTHING is the idempotency mechanism: a re-inserted
  // event_uid is silently skipped instead of erroring or duplicating.
  const result = await sql`
    INSERT INTO events ${sql(rows)}
    ON CONFLICT (event_uid) DO NOTHING
  `;

  ackQueueFile(claimedPath);
  return { inserted: result.count, skipped: rows.length - result.count };
}
