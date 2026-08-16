import { describe, expect, test } from "bun:test";
import { coalesceRuns, markAiLines, normalizeKey } from "../src/enrich/attribute.ts";

describe("normalizeKey", () => {
  test("trims leading/trailing whitespace", () => {
    expect(normalizeKey("  const x = 1;")).toBe("const x = 1;");
  });

  test("collapses internal whitespace runs to a single space", () => {
    expect(normalizeKey("const   x  =  1;")).toBe("const x = 1;");
  });

  test("tabs count as whitespace too", () => {
    expect(normalizeKey("\tfoo(  )")).toBe("foo( )");
  });

  test("two differently-formatted lines normalize to the same key", () => {
    expect(normalizeKey("  const  x=1;  ")).toBe(normalizeKey("const x=1;"));
  });

  test("empty line stays empty", () => {
    expect(normalizeKey("   ")).toBe("");
  });
});

describe("coalesceRuns", () => {
  test("a lone match is too weak on its own", () => {
    expect(coalesceRuns([true], 3)).toEqual([false]);
  });

  test("a run of 2 is still below the threshold", () => {
    expect(coalesceRuns([true, true], 3)).toEqual([false, false]);
  });

  test("a run of exactly runMin survives", () => {
    expect(coalesceRuns([true, true, true], 3)).toEqual([true, true, true]);
  });

  test("a qualifying run keeps its surrounding false marks untouched", () => {
    expect(coalesceRuns([false, true, true, true, false], 3)).toEqual([
      false, true, true, true, false,
    ]);
  });

  test("a short run and a long run in the same array are judged independently", () => {
    expect(coalesceRuns([true, true, false, true, true, true], 3)).toEqual([
      false, false, false, true, true, true,
    ]);
  });

  test("all false stays all false", () => {
    expect(coalesceRuns([false, false, false], 3)).toEqual([false, false, false]);
  });
});

describe("markAiLines", () => {
  test("100% AI: every added line came straight from an AI snippet", () => {
    const snippet = "function foo() {\n  return null;\n}";
    const added = ["function foo() {", "  return null;", "}"];
    expect(markAiLines(added, [snippet])).toEqual({ addedLines: 3, aiLines: 3 });
  });

  test("100% human: no AI snippets at all", () => {
    const added = ["const bar = 5;", "const baz = 6;", "const qux = 7;"];
    expect(markAiLines(added, [])).toEqual({ addedLines: 3, aiLines: 0 });
  });

  test("interleaved: an AI block and a human block in one commit", () => {
    const snippet = "function foo() {\n  return null;\n}";
    const added = [
      "function foo() {",
      "  return null;",
      "}",
      "const bar = 5;",
      "const baz = 6;",
    ];
    // first 3 lines are a qualifying AI run; last 2 are unmatched (human).
    expect(markAiLines(added, [snippet])).toEqual({ addedLines: 5, aiLines: 3 });
  });

  test("reindented AI code still matches (normalizeKey absorbs leading whitespace)", () => {
    const snippet = "function foo() {\n    return null;\n}"; // AI wrote 4-space indent
    const added = ["function foo() {", "  return null;", "}"]; // committed as 2-space indent
    expect(markAiLines(added, [snippet])).toEqual({ addedLines: 3, aiLines: 3 });
  });

  test("a lone coincidental match doesn't count as AI", () => {
    const snippet = "return null;";
    const added = ["const bar = 5;", "return null;", "const baz = 6;"];
    expect(markAiLines(added, [snippet])).toEqual({ addedLines: 3, aiLines: 0 });
  });
});
