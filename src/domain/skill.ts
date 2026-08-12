// Pure domain logic — zero I/O, fully unit-tested. This answers "how much
// can I still trust that I know this," computed at read time rather than
// stored, so the decay rule can change later without losing history.
import type { LedgerEntry } from "../types.ts";
import { daysBetween } from "../util.ts";

/** True when P rests solely on manual claims, never on verified production. */
export function isClaimedOnly(entry: LedgerEntry): boolean {
  return entry.coding_level > 0 && !entry.evidence.some((e) => e.type === "produced");
}

/** Stored coding_level minus one level per full decay window since the last
 *  evidence (last_produced, or the latest claim if never produced). The
 *  stored value never changes — only this function's output does. */
export function effectiveP(entry: LedgerEntry, now = new Date()): number {
  if (entry.coding_level === 0) return 0;

  const baseline =
    entry.last_produced ??
    entry.evidence.filter((e) => e.type === "claimed").at(-1)?.date ??
    null;
  if (!baseline) return entry.coding_level;

  const days = Math.max(0, daysBetween(baseline, now));
  const levelsDecayed = Math.floor(days / entry.decay_days.p);
  return Math.max(0, entry.coding_level - levelsDecayed);
}

/** Days until effective P next drops a level. null once already at 0, or
 *  with no baseline to count from. */
export function daysUntilDecay(entry: LedgerEntry, now = new Date()): number | null {
  if (effectiveP(entry, now) === 0) return null;

  const baseline =
    entry.last_produced ?? entry.evidence.filter((e) => e.type === "claimed").at(-1)?.date;
  if (!baseline) return null;

  const days = Math.max(0, daysBetween(baseline, now));
  const windowElapsed = Math.floor(days / entry.decay_days.p);
  return (windowElapsed + 1) * entry.decay_days.p - days;
}

/** within = proven recently (real evidence). claimed = self-reported, no
 *  evidence backing it. beyond = no live P at all, or never had any. */
export type SkillBucket = "within" | "beyond" | "claimed";

/** The one true skill classification — replaces three near-duplicate copies
 *  of this logic from the old codebase's report, gate, and gaps commands. */
export function bucketOf(entry: LedgerEntry | undefined, now = new Date()): SkillBucket {
  if (!entry) return "beyond";
  if (effectiveP(entry, now) === 0) return "beyond";
  return isClaimedOnly(entry) ? "claimed" : "within";
}
