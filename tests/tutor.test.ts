import { describe, expect, test } from "bun:test";
import { buildInjection, conceptMatches, findBeyondConcepts, hasCodeIntent } from "../src/tutor.ts";
import type { Ledger, LedgerEntry } from "../src/types.ts";

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    understanding: 1,
    coding_level: 0,
    last_produced: null,
    decay_days: { u: 180, p: 45 },
    evidence: [],
    ...overrides,
  };
}

describe("hasCodeIntent", () => {
  test("code-shaped prompts trigger", () => {
    expect(hasCodeIntent("write a function that parses JSON")).toBe(true);
    expect(hasCodeIntent("fix the bug in my parser")).toBe(true);
    expect(hasCodeIntent("refactor this to use a Map")).toBe(true);
  });
  test("non-code prompts don't", () => {
    expect(hasCodeIntent("what did I work on last week?")).toBe(false);
    expect(hasCodeIntent("summarize this article for me")).toBe(false);
  });
});

describe("conceptMatches", () => {
  test("full title verbatim", () => {
    expect(conceptMatches("help me with python decorators here", "Python Decorators")).toBe(true);
  });
  test("all tokens present in any order", () => {
    expect(conceptMatches("write a decorators helper in python", "Python Decorators")).toBe(true);
  });
  test("long titles tolerate one missing token", () => {
    expect(
      conceptMatches("write an async event loop handler in python", "Python async/await and the Event Loop")
    ).toBe(true);
  });
  test("partial mention does not match short titles", () => {
    expect(conceptMatches("I love python", "Python Decorators")).toBe(false);
    expect(conceptMatches("use react state", "React Hooks")).toBe(false);
  });
});

describe("findBeyondConcepts", () => {
  const ledger: Ledger = {
    updated: "",
    concepts: {
      "Python Decorators": entry(), // P=0 → beyond
      "React Hooks": entry({
        coding_level: 1,
        last_produced: new Date().toISOString(), // fresh P → within
        evidence: [{ type: "produced", ref: "commit:abc", date: new Date().toISOString() }],
      }),
      "Tree-sitter": entry({
        coding_level: 2,
        evidence: [{ type: "claimed", ref: "manual", date: new Date().toISOString() }], // claimed-only
      }),
    },
  };

  test("flags P=0 and claimed-only, skips verified", () => {
    const hits = findBeyondConcepts("write python decorators using tree-sitter and react hooks", ledger);
    const names = hits.map((h) => h.title);
    expect(names).toContain("Python Decorators");
    expect(names).toContain("Tree-sitter");
    expect(names).not.toContain("React Hooks");
  });

  test("no mention, no hit", () => {
    expect(findBeyondConcepts("write a sql query", ledger)).toHaveLength(0);
  });
});

describe("buildInjection", () => {
  test("silent when nothing to say", () => {
    expect(buildInjection([], null)).toBeNull();
  });
  test("tutor block names concepts and the override protocol", () => {
    const out = buildInjection([{ title: "Python Decorators", claimedOnly: false }], null)!;
    expect(out).toContain("TUTOR MODE");
    expect(out).toContain("Python Decorators");
    expect(out).toContain("mirror override");
    expect(out).toContain("Never refuse");
  });
  test("style digest appended for code prompts", () => {
    const out = buildInjection([], "ts: early returns, no classes")!;
    expect(out).toContain("ai-mirror-style");
    expect(out).toContain("early returns");
  });
});
