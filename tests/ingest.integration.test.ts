// Integration test — needs DATABASE_URL pointed at a real Postgres with the
// 001_init schema applied (bun run migrate). Proves the idempotency claim
// from the plan: draining the same file twice inserts N rows, then 0.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, db } from "../src/db/client.ts";
import { drainQueueFile } from "../src/ingest/drain.ts";
import { claimQueueFile } from "../src/ingest/queue.ts";
import type { QueuedEvent } from "../src/types.ts";

const testRepo = `/tmp/ingest-test-${Date.now()}`;

function makeEvent(file: string, after: string): QueuedEvent {
  return {
    ts: new Date().toISOString(),
    tool: "Edit",
    repo: testRepo,
    file: `${testRepo}/${file}`,
    lang: "ts",
    code_hash: `sha256:test-${file}-${after.length}`,
    before_text: "old",
    after_text: after,
    truncated: false,
  };
}

describe("drainQueueFile idempotency", () => {
  afterAll(async () => {
    await db()`DELETE FROM events WHERE repo = ${testRepo}`;
    await closeDb();
  });

  test("draining the same file twice inserts N rows, then 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-mirror-queue-"));
    const events = [makeEvent("a.ts", "line1\nline2"), makeEvent("b.ts", "line1")];
    const path = join(dir, "2026-01-01.jsonl");
    writeFileSync(path, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

    // First drain: file exists, gets claimed and consumed.
    const claimed1 = claimQueueFile(path);
    expect(claimed1).not.toBeNull();
    const first = await drainQueueFile(db(), claimed1!);
    expect(first).toEqual({ inserted: 2, skipped: 0 });

    // Recreate the same queue file (simulating "process crashed after insert,
    // before the file was acked, so it got replayed") and drain again.
    const path2 = join(dir, "2026-01-01-replay.jsonl");
    writeFileSync(path2, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    const claimed2 = claimQueueFile(path2);
    const second = await drainQueueFile(db(), claimed2!);
    expect(second).toEqual({ inserted: 0, skipped: 2 });

    const rows = await db()`SELECT count(*)::int AS n FROM events WHERE repo = ${testRepo}`;
    expect(rows[0]?.["n"]).toBe(2);
  });
});
