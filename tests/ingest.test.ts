import { describe, expect, test } from "bun:test";
import { diffLineCounts, eventUid } from "../src/ingest/drain.ts";
import type { QueuedEvent } from "../src/types.ts";

describe("eventUid", () => {
  test("deterministic from content — same event twice gives the same uid", () => {
    const e: QueuedEvent = {
      ts: "2026-08-07T13:00:00.000Z",
      tool: "Edit",
      repo: "/repo",
      file: "/repo/a.ts",
      lang: "ts",
      code_hash: "sha256:abc",
      before_text: "x",
      after_text: "y",
      truncated: false,
    };
    expect(eventUid(e)).toBe(eventUid(structuredClone(e)));
  });

  test("different code_hash (same ts/file) gives a different uid", () => {
    const base: QueuedEvent = {
      ts: "2026-08-07T13:00:00.000Z",
      tool: "Edit",
      repo: "/repo",
      file: "/repo/a.ts",
      lang: "ts",
      code_hash: "sha256:abc",
      before_text: "x",
      after_text: "y",
      truncated: false,
    };
    const changed = { ...base, code_hash: "sha256:def" };
    expect(eventUid(base)).not.toBe(eventUid(changed));
  });
});

describe("diffLineCounts", () => {
  test("Write with no before: everything is added, nothing removed", () => {
    expect(diffLineCounts(null, "a\nb\nc")).toEqual({ added: 3, removed: 0 });
  });

  test("pure addition inside an existing block", () => {
    expect(diffLineCounts("a\nc", "a\nb\nc")).toEqual({ added: 1, removed: 0 });
  });

  test("pure removal", () => {
    expect(diffLineCounts("a\nb\nc", "a\nc")).toEqual({ added: 0, removed: 1 });
  });

  test("one line changed in a 3-line block counts as 1 added + 1 removed, not 3", () => {
    expect(diffLineCounts("a\nb\nc", "a\nX\nc")).toEqual({ added: 1, removed: 1 });
  });

  test("duplicate lines are counted per-occurrence, not deduplicated", () => {
    // "b" appears once in before, twice in after -> one net addition of "b".
    expect(diffLineCounts("a\nb\nc", "a\nb\nb\nc")).toEqual({ added: 1, removed: 0 });
  });

  test("no-op edit: identical before/after", () => {
    expect(diffLineCounts("a\nb", "a\nb")).toEqual({ added: 0, removed: 0 });
  });
});
