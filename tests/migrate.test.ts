import { describe, expect, test } from "bun:test";
import { migrateRows } from "../src/migrate.ts";

describe("migrateRows", () => {
  const v1Row = {
    ts: "2026-06-30T16:00:28.532Z",
    author: "ai",
    tool: "Edit",
    file: "d:/Code-3/ai-mirror/index.ts",
    project: "D:\\Code-3\\ai-mirror",
    lines: 1,
    concepts: ["async_await", "Claude Code Hooks"],
  };

  test("upgrades v1 rows and splits concepts into tags vs vault titles", () => {
    const { events, cacheSeed, migrated } = migrateRows([v1Row]);
    expect(migrated).toBe(1);
    const e = events[0]!;
    expect(e.v).toBe(2);
    expect(e.code_hash).toBe("legacy:0");
    expect(e.project).toBe("D:/Code-3/ai-mirror");
    expect(e.lang).toBe("ts");
    expect(cacheSeed["legacy:0"]).toEqual({
      tags: ["async_await"],
      concepts: ["Claude Code Hooks"],
      mapped: true,
      ts: v1Row.ts,
    });
  });

  test("v2 rows pass through untouched", () => {
    const v2Row = { ...v1Row, v: 2, code_hash: "sha256:aa", snippet: "x", lang: "ts" };
    const { events, migrated } = migrateRows([v2Row]);
    expect(migrated).toBe(0);
    expect(events[0]).toBe(v2Row as never);
  });
});
