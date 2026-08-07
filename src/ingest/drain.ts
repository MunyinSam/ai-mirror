// Ingest — the step that turns "at-least-once delivery" into "effectively-once".
//
// A queue file can be drained twice: the process could crash after inserting
// but before deleting the file, and next run would see it again. That's fine
// IF insert is idempotent. This file is where that idempotency actually lives.
//
// YOU ARE WRITING drainQueueFile(). See the walkthrough in chat.
import { readFileSync } from "node:fs";
import type { Sql } from "../db/client.ts";
import type { QueuedEvent } from "../types.ts";
import { sha256 } from "../util.ts";
import { ackQueueFile } from "./queue.ts";

export interface DrainResult {
  inserted: number;
  skipped: number;
}

/** The natural key: deterministic from content, so re-inserting the same
 *  event (because the file got drained twice) collides on this and is a
 *  no-op rather than a duplicate row. */
export function eventUid(e: QueuedEvent): string {
  return sha256(`${e.ts}|${e.file}|${e.code_hash}`);
}

/** Count added/removed lines between two texts. This is bookkeeping for the
 *  events table (roughly "how much changed"), NOT authorship attribution —
 *  that's a different, harder algorithm that runs later against git commits
 *  (src/enrich/attribute.ts), because only a committed diff has a stable
 *  "who else touched this file since" story. A reasonable line-set diff
 *  here is enough: lines in `after` not present in `before` are added,
 *  and vice versa for removed.
 *
 *  TODO(you): implement. Multiset, not Set — a line appearing twice in
 *  `after` but once in `before` should count once as added, not zero.
 */
export function diffLineCounts(
  before: string | null,
  after: string
): { added: number; removed: number } {
  const beforeLines = before == null ? [] : before.split("\n");
  const afterLines = after.split("\n")

  const counts = new Map<string, number>();
  // count.get(line) return undefined or existing line count
  for (const line of beforeLines) counts.set(line, (counts.get(line) ?? 0) - 1);
  for (const line of afterLines) counts.set(line, (counts.get(line) ?? 0) + 1);

  let added = 0;
  let removed = 0;
  for (const delta of counts.values()) {
    if (delta > 0) added += delta;
    else removed += -delta;
  }
  return { added, removed }
}

/** Read one claimed queue file, insert every line's event idempotently,
 *  then delete the file. TODO(you): implement.
 *
 *  Shape to follow:
 *    1. readFileSync(claimedPath, "utf8"), split on "\n", drop blank lines
 *    2. JSON.parse each line -> QueuedEvent
 *    3. for each: compute event_uid (above) and diffLineCounts
 *    4. sql`INSERT INTO events ${sql(rows)} ... ON CONFLICT (event_uid) DO NOTHING`
 *       — batch it, don't loop one INSERT per row
 *    5. count how many rows actually landed (postgres.js gives you this on
 *       the result) vs how many you attempted -> {inserted, skipped}
 *    6. only call ackQueueFile(claimedPath) AFTER the insert has committed
 */
export async function drainQueueFile(sql: Sql, claimedPath: string): Promise<DrainResult> {
  throw new Error("not implemented");
}
