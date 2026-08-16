import { describe, expect, test } from "bun:test";
import { bucketOf, daysUntilDecay, effectiveP, isClaimedOnly } from "../src/domain/skill.ts";
import type { LedgerEntry } from "../src/types.ts";

const DECAY = { u: 180, p: 45 };

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    concept: "test-concept",
    understanding: 2,
    coding_level: 2,
    last_produced: null,
    decay_days: DECAY,
    evidence: [],
    ...overrides,
  };
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

describe("isClaimedOnly", () => {
  test("false when there's no P at all", () => {
    expect(isClaimedOnly(entry({ coding_level: 0 }))).toBe(false);
  });

  test("true when P is set but no produced evidence exists", () => {
    expect(
      isClaimedOnly(entry({ coding_level: 1, evidence: [{ type: "claimed", ref: "manual", date: daysAgo(1) }] }))
    ).toBe(true);
  });

  test("false once any produced evidence exists", () => {
    expect(
      isClaimedOnly(
        entry({ coding_level: 1, evidence: [{ type: "produced", ref: "commit:abc", date: daysAgo(1) }] })
      )
    ).toBe(false);
  });
});

describe("effectiveP", () => {
  test("coding_level 0 is always 0, regardless of evidence", () => {
    expect(effectiveP(entry({ coding_level: 0 }))).toBe(0);
  });

  test("no baseline (no evidence, no last_produced) returns the stored level unchanged", () => {
    expect(effectiveP(entry({ coding_level: 3, last_produced: null, evidence: [] }))).toBe(3);
  });

  test("within one decay window: no drop yet", () => {
    const e = entry({ coding_level: 2, last_produced: daysAgo(10) }); // p window = 45
    expect(effectiveP(e)).toBe(2);
  });

  test("exactly one full window elapsed: drops one level", () => {
    const e = entry({ coding_level: 2, last_produced: daysAgo(45) });
    expect(effectiveP(e)).toBe(1);
  });

  test("multiple windows elapsed: drops multiple levels, floored at 0", () => {
    const e = entry({ coding_level: 2, last_produced: daysAgo(200) }); // 4 windows of 45
    expect(effectiveP(e)).toBe(0);
  });

  test("claimed-only entry decays from the latest claim date", () => {
    const e = entry({
      coding_level: 1,
      last_produced: null,
      evidence: [{ type: "claimed", ref: "manual", date: daysAgo(50) }],
    });
    expect(effectiveP(e)).toBe(0); // one window (45) elapsed since the claim
  });

  test("last_produced takes priority over an older claim", () => {
    const e = entry({
      coding_level: 2,
      last_produced: daysAgo(1),
      evidence: [{ type: "claimed", ref: "manual", date: daysAgo(100) }],
    });
    expect(effectiveP(e)).toBe(2); // baseline is the recent production, not the old claim
  });
});

describe("daysUntilDecay", () => {
  test("null once effective P is already 0", () => {
    expect(daysUntilDecay(entry({ coding_level: 0 }))).toBeNull();
  });

  test("null with no baseline to count from", () => {
    expect(daysUntilDecay(entry({ coding_level: 2, last_produced: null, evidence: [] }))).toBeNull();
  });

  test("counts down within the current window", () => {
    const e = entry({ coding_level: 2, last_produced: daysAgo(10) }); // p = 45
    expect(daysUntilDecay(e)).toBe(35);
  });

  test("restarts the countdown right after a level drop", () => {
    const e = entry({ coding_level: 2, last_produced: daysAgo(46) }); // 1 day into the 2nd window
    expect(daysUntilDecay(e)).toBe(44);
  });
});

describe("bucketOf", () => {
  test("no entry at all -> beyond", () => {
    expect(bucketOf(undefined)).toBe("beyond");
  });

  test("effective P is 0 -> beyond, even with old evidence", () => {
    expect(bucketOf(entry({ coding_level: 1, last_produced: daysAgo(200) }))).toBe("beyond");
  });

  test("claimed-only with live P -> claimed", () => {
    expect(
      bucketOf(entry({ coding_level: 1, evidence: [{ type: "claimed", ref: "manual", date: daysAgo(1) }] }))
    ).toBe("claimed");
  });

  test("produced evidence with live P -> within", () => {
    expect(
      bucketOf(entry({ coding_level: 1, last_produced: daysAgo(1), evidence: [{ type: "produced", ref: "commit:a", date: daysAgo(1) }] }))
    ).toBe("within");
  });
});
