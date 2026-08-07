import { describe, expect, test } from "bun:test";
import { coalesceRuns, normalizeKey } from "../src/enrich/attribute.ts";

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
