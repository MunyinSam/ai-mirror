// Pure domain logic — zero I/O, fully unit-tested. This answers "how much
// can I still trust that I know this," and it's computed at read time rather
// than stored, so changing the decay rule later reinterprets history instead
// of destroying it.
//
// YOU ARE WRITING effectiveP(), daysUntilDecay(), bucketOf(). Walkthroughs in chat.
import type { LedgerEntry } from "../types.ts";
import { daysBetween } from "../util.ts";

/** True when P rests solely on manual claims, never on verified production —
 *  always worth flagging distinctly from earned skill. */
export function isClaimedOnly(entry: LedgerEntry): boolean {
  return entry.coding_level > 0 && !entry.evidence.some((e) => e.type === "produced");
}

/** Effective P: the stored coding_level minus one level per full decay
 *  window elapsed since the last evidence. The STORED value never changes —
 *  only what this function returns does, which is what lets the decay rule
 *  itself change later without losing history.
 *

 *    - coding_level === 0 -> always 0 (nothing to decay from).
 *    - baseline = entry.last_produced, or (if that's null) the date of the
 *      most recent "claimed" evidence, or null if there's no evidence at all.
 *    - no baseline -> effective P is just the stored coding_level (nothing
 *      to measure decay against yet).
 *    - otherwise: days = daysBetween(baseline, now); levels decayed =
 *      floor(days / entry.decay_days.p); return coding_level - that,
 *      floored at 0.
 */
export function effectiveP(entry: LedgerEntry, now = new Date()): number {
  if (entry.coding_level === 0) return 0;

  const baseline =
    entry.last_produced ??
    entry.evidence.filter((e) => e.type === "claimed").at(-1)?.date ??
    null;
  if (!baseline) return entry.coding_level;

  const days = Math.max(0, daysBetween(baseline, now))
  const levelsDecayed = Math.floor(days / entry.decay_days.p);
  return Math.max(0, entry.coding_level - levelsDecayed);
}

/** Days until effective P next drops a level. null if already at 0 (nothing
 *  left to lose), or there's no baseline to count from.
 *
 *  TODO(you): implement.
 *    - same baseline logic as effectiveP; if effectiveP(entry, now) === 0,
 *      return null immediately (already bottomed out).
 *    - days = daysBetween(baseline, now) tells you how far into the decay
 *      timeline you are. floor(days / decay_days.p) is how many FULL windows
 *      have already elapsed. The next drop happens at the END of the next
 *      window: (that count + 1) * decay_days.p total days from baseline.
 *      Subtract the days already elapsed to get days remaining.
 */
export function daysUntilDecay(entry: LedgerEntry, now = new Date()): number | null {
  throw new Error("not implemented");
}

export type SkillBucket = "within" | "beyond" | "claimed";

/** The one true skill classification — replaces three near-duplicate copies
 *  of this same logic that existed across the old codebase's report, gate,
 *  and gaps commands.
 *
 *  TODO(you): implement.
 *    - no entry at all -> "beyond" (never produced or claimed).
 *    - effectiveP(entry, now) === 0 -> "beyond" (decayed away, or never had P).
 *    - otherwise: isClaimedOnly(entry) -> "claimed"; else -> "within".
 */
export function bucketOf(entry: LedgerEntry | undefined, now = new Date()): SkillBucket {
  throw new Error("not implemented");
}
