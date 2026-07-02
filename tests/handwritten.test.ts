import { describe, expect, test } from "bun:test";
import { buildAiLineSet, handwrittenHunks, parseAddedHunks } from "../src/handwritten.ts";
import type { MirrorEvent } from "../src/types.ts";

const GIT_OUTPUT = [
  "COMMIT\tabc1234def\t2026-07-01T10:00:00+07:00",
  "diff --git a/src/app.ts b/src/app.ts",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -0,0 +3,3 @@",
  "+export function greet(name: string) {",
  '+  return `hello ${name}`;',
  "+}",
  "@@ -10,0 +20,1 @@",
  "+const x = 1;",
  "diff --git a/README.md b/README.md",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -0,0 +1,3 @@",
  "+# Title",
  "+some prose here for the readme",
  "+more prose",
].join("\n");

function aiEvent(snippet: string): MirrorEvent {
  return {
    v: 2, ts: "2026-07-01T09:00:00Z", author: "ai", tool: "Write",
    file: "D:/x/src/app.ts", project: "D:/x", lang: "ts",
    lines: snippet.split("\n").length, code_hash: "sha256:x", snippet,
  };
}

describe("parseAddedHunks", () => {
  test("splits added lines by commit, file, and @@ block", () => {
    const hunks = parseAddedHunks(GIT_OUTPUT);
    expect(hunks).toHaveLength(3);
    expect(hunks[0]).toMatchObject({
      commit: "abc1234def",
      date: "2026-07-01T10:00:00+07:00",
      file: "src/app.ts",
    });
    expect(hunks[0]!.lines).toHaveLength(3);
    expect(hunks[1]!.lines).toEqual(["const x = 1;"]);
  });
});

describe("handwrittenHunks", () => {
  test("keeps code hunks that don't match AI snippets", () => {
    const hunks = parseAddedHunks(GIT_OUTPUT);
    const survivors = handwrittenHunks(hunks, new Set());
    // README (not code) and the 1-line hunk (too small) are dropped
    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.file).toBe("src/app.ts");
  });

  test("drops hunks whose lines the AI wrote", () => {
    const ai = buildAiLineSet([
      aiEvent("export function greet(name: string) {\n  return `hello ${name}`;\n}"),
    ]);
    const survivors = handwrittenHunks(parseAddedHunks(GIT_OUTPUT), ai);
    expect(survivors).toHaveLength(0);
  });

  test("insignificant lines (braces, blanks) don't count as matches", () => {
    const hunk = {
      commit: "c", date: "d", file: "a.ts",
      lines: ["}", "", "const uniqueLine = computeSomething();", "return uniqueLine + 1;", "}"],
    };
    expect(handwrittenHunks([hunk], new Set())).toHaveLength(1);
  });
});
