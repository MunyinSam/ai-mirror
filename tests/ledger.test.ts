import { describe, expect, test } from "bun:test";
import { addProducedEvidence, daysUntilDecay, effectiveP, isClaimedOnly, setClaimedLevel } from "../src/ledger.ts";
import type { Ledger, LedgerEntry } from "../src/types.ts";
import { confidenceToU } from "../src/vault.ts";

const NOW = new Date("2026-07-02T00:00:00Z");

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    understanding: 0,
    coding_level: 0,
    last_produced: null,
    decay_days: { u: 180, p: 45 },
    evidence: [],
    ...overrides,
  };
}

describe("effectiveP decay", () => {
  test("full level within the decay window", () => {
    const e = entry({ coding_level: 1, last_produced: "2026-06-01T00:00:00Z" }); // 31 days
    expect(effectiveP(e, NOW)).toBe(1);
  });

  test("drops one level per full window", () => {
    const e = entry({ coding_level: 2, last_produced: "2026-05-01T00:00:00Z" }); // 62 days
    expect(effectiveP(e, NOW)).toBe(1);
  });

  test("never negative", () => {
    const e = entry({ coding_level: 1, last_produced: "2025-01-01T00:00:00Z" });
    expect(effectiveP(e, NOW)).toBe(0);
  });

  test("zero stored P stays zero", () => {
    expect(effectiveP(entry(), NOW)).toBe(0);
  });

  test("claimed-only entries decay from the claim date", () => {
    const e = entry({
      coding_level: 1,
      evidence: [{ type: "claimed", ref: "manual", date: "2026-06-20T00:00:00Z" }],
    });
    expect(effectiveP(e, NOW)).toBe(1);
    expect(isClaimedOnly(e)).toBe(true);
  });
});

describe("daysUntilDecay", () => {
  test("counts down to the next window boundary", () => {
    const e = entry({ coding_level: 1, last_produced: "2026-06-01T00:00:00Z" }); // day 31 of 45
    expect(daysUntilDecay(e, NOW)).toBe(14);
  });

  test("null once effective P is 0", () => {
    const e = entry({ coding_level: 1, last_produced: "2025-01-01T00:00:00Z" });
    expect(daysUntilDecay(e, NOW)).toBeNull();
  });
});

describe("evidence", () => {
  test("produced evidence raises P and is idempotent per ref", () => {
    const ledger: Ledger = { updated: "", concepts: {} };
    expect(addProducedEvidence(ledger, "decorators", "commit:abc1234", "2026-07-01")).toBe(true);
    expect(addProducedEvidence(ledger, "decorators", "commit:abc1234", "2026-07-01")).toBe(false);
    const e = ledger.concepts["decorators"]!;
    expect(e.coding_level).toBe(1);
    expect(e.last_produced).toBe("2026-07-01");
    expect(e.evidence).toHaveLength(1);
    expect(isClaimedOnly(e)).toBe(false);
  });

  test("manual claims never count as produced", () => {
    const ledger: Ledger = { updated: "", concepts: {} };
    setClaimedLevel(ledger, "react-hooks", 2);
    const e = ledger.concepts["react-hooks"]!;
    expect(e.coding_level).toBe(2);
    expect(isClaimedOnly(e)).toBe(true);
  });
});

describe("confidenceToU", () => {
  test("maps the vault scale", () => {
    expect(confidenceToU("fluent")).toBe(3);
    expect(confidenceToU("solid")).toBe(2);
    expect(confidenceToU("learning")).toBe(1);
    expect(confidenceToU(null)).toBe(1);
  });
});
