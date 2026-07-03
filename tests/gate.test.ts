import { describe, expect, test } from "bun:test";
import { assessStaged, hunkInputs, stagedAiPct, stagedCodeHunks } from "../src/gate.ts";
import type { AddedHunk } from "../src/handwritten.ts";
import { sha256 } from "../src/util.ts";
import type { ClassifyCache, Ledger, LedgerEntry, MirrorEvent } from "../src/types.ts";

function hunk(file: string, lines: string[]): AddedHunk {
  return { commit: "", date: "", file, lines };
}

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

describe("stagedCodeHunks", () => {
  test("keeps code files, drops docs/configs/vendored/thin hunks", () => {
    const code = ["const parseThing = (raw: string) => {", "  return JSON.parse(raw);", "};"];
    const kept = stagedCodeHunks([
      hunk("src/a.ts", code),
      hunk("README.md", code),
      hunk("node_modules/x/y.ts", code),
      hunk("src/b.ts", ["const x = 1;"]), // too thin
    ]);
    expect(kept.map((h) => h.file)).toEqual(["src/a.ts"]);
  });

  test("AI-matched hunks stay in — the gate judges code, not author", () => {
    // (no AI filtering happens here at all; this pins the contract)
    const kept = stagedCodeHunks([hunk("src/a.py", ["def f():", "    return compute(x)", "    # done"])]);
    expect(kept).toHaveLength(1);
  });
});

describe("hunkInputs", () => {
  test("hashes the hunk text so re-commits hit the classify cache", () => {
    const lines = ["async function load() {", "  await fetchAll();", "}"];
    const [input] = hunkInputs([hunk("src/a.ts", lines)]);
    expect(input!.code_hash).toBe(sha256(lines.join("\n")));
    expect(input!.lang).toBe("ts");
    expect(input!.snippet).toBe(lines.join("\n"));
  });
});

describe("stagedAiPct", () => {
  const events: MirrorEvent[] = [
    {
      v: 2,
      ts: "",
      author: "ai",
      tool: "Edit",
      file: "src/a.ts",
      project: "D:/repo",
      lang: "ts",
      lines: 2,
      code_hash: "sha256:x",
      snippet: "const fromAiLand = await client.create();\nreturn fromAiLand.result;",
    },
  ];

  test("counts the share of significant staged lines found in the AI log", () => {
    const pct = stagedAiPct(
      [
        hunk("src/a.ts", [
          "const fromAiLand = await client.create();", // AI
          "const handTyped = somethingElse();", // you
          "}", // insignificant — excluded
        ]),
      ],
      events
    );
    expect(pct).toBe(50);
  });

  test("null when nothing significant is staged", () => {
    expect(stagedAiPct([hunk("src/a.ts", ["}", "{", ""])], events)).toBeNull();
  });
});

describe("assessStaged", () => {
  const lines = ["function useThing() {", "  return useEffect(() => {}, []);", "}"];
  const inputs = hunkInputs([hunk("src/a.tsx", lines)]);
  const hash = inputs[0]!.code_hash;

  const ledger: Ledger = {
    updated: "",
    concepts: {
      "React Hooks": entry({
        coding_level: 1,
        last_produced: new Date().toISOString(),
        evidence: [{ type: "produced", ref: "commit:abc", date: new Date().toISOString() }],
      }),
      "Tree-sitter": entry({
        coding_level: 2,
        evidence: [{ type: "claimed", ref: "manual", date: new Date().toISOString() }],
      }),
      "Python Decorators": entry(), // P=0
    },
  };

  test("routes concepts to within / claimed-only / beyond; unfiled passes through", () => {
    const cache: ClassifyCache = {
      [hash]: {
        tags: [],
        concepts: ["React Hooks", "Tree-sitter", "Python Decorators", "Not In Ledger"],
        mapped: true,
        suggested: ["Web Workers"],
        ts: "",
      },
    };
    const result = assessStaged(inputs, cache, ledger);
    expect(result.assessed).toBe(true);
    expect(result.within).toEqual(["React Hooks"]);
    expect(result.claimedOnly).toEqual(["Tree-sitter"]);
    expect(result.beyond).toEqual(["Not In Ledger", "Python Decorators"]);
    expect(result.unfiled).toEqual(["Web Workers"]);
  });

  test("unmapped cache entries leave the gate with nothing to say", () => {
    const cache: ClassifyCache = {
      [hash]: { tags: ["arrow_function"], concepts: [], mapped: false, suggested: [], ts: "" },
    };
    const result = assessStaged(inputs, cache, ledger);
    expect(result.assessed).toBe(false);
    expect(result.beyond).toEqual([]);
  });

  test("decayed P counts as beyond", () => {
    const decayed: Ledger = {
      updated: "",
      concepts: {
        "React Hooks": entry({
          coding_level: 1,
          last_produced: "2020-01-01T00:00:00Z",
          evidence: [{ type: "produced", ref: "commit:old", date: "2020-01-01T00:00:00Z" }],
        }),
      },
    };
    const cache: ClassifyCache = {
      [hash]: { tags: [], concepts: ["React Hooks"], mapped: true, suggested: [], ts: "" },
    };
    expect(assessStaged(inputs, cache, decayed).beyond).toEqual(["React Hooks"]);
  });
});
