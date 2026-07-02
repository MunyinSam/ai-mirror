// The Skill Ledger (CONCEPTS §5) — U mirrored from the vault, P earned only
// by producing code. Decay is computed at read time; stored values are never
// destroyed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_DECAY, type Evidence, type Ledger, type LedgerEntry } from "./types.ts";
import { confidenceToU, type VaultConcept } from "./vault.ts";
import { daysBetween } from "./util.ts";

export function loadLedger(skillsPath: string): Ledger {
  if (!existsSync(skillsPath)) {
    return { updated: new Date().toISOString(), concepts: {} };
  }
  return JSON.parse(readFileSync(skillsPath, "utf8")) as Ledger;
}

export function saveLedger(skillsPath: string, ledger: Ledger): void {
  ledger.updated = new Date().toISOString();
  writeFileSync(skillsPath, JSON.stringify(ledger, null, 2), "utf8");
}

function emptyEntry(): LedgerEntry {
  return {
    understanding: 0,
    coding_level: 0,
    last_produced: null,
    decay_days: { ...DEFAULT_DECAY },
    evidence: [],
  };
}

/** Mirror U from the vault. The vault owns U; the ledger never edits it. */
export function syncUnderstanding(ledger: Ledger, vault: VaultConcept[]): void {
  for (const concept of vault) {
    const entry = (ledger.concepts[concept.title] ??= emptyEntry());
    entry.understanding = confidenceToU(concept.confidence);
  }
}

/** Effective P: stored P minus one level per full decay window since the last
 *  production (or claim, for claimed-only entries). Never negative. */
export function effectiveP(entry: LedgerEntry, now = new Date()): number {
  if (entry.coding_level === 0) return 0;
  const baseline =
    entry.last_produced ??
    entry.evidence.filter((e) => e.type === "claimed").at(-1)?.date ??
    null;
  if (!baseline) return entry.coding_level;
  const days = Math.max(0, daysBetween(baseline, now));
  return Math.max(0, entry.coding_level - Math.floor(days / entry.decay_days.p));
}

/** Days until effective P next drops a level; null if already at 0. */
export function daysUntilDecay(entry: LedgerEntry, now = new Date()): number | null {
  if (effectiveP(entry, now) === 0) return null;
  const baseline =
    entry.last_produced ?? entry.evidence.filter((e) => e.type === "claimed").at(-1)?.date;
  if (!baseline) return null;
  const days = Math.max(0, daysBetween(baseline, now));
  return (Math.floor(days / entry.decay_days.p) + 1) * entry.decay_days.p - days;
}

/** True when P rests solely on manual claims — always shown with a ⚠. */
export function isClaimedOnly(entry: LedgerEntry): boolean {
  return entry.coding_level > 0 && !entry.evidence.some((e) => e.type === "produced");
}

/** Record verified production of a concept. Idempotent per (concept, ref). */
export function addProducedEvidence(
  ledger: Ledger,
  concept: string,
  ref: string,
  date: string
): boolean {
  const entry = (ledger.concepts[concept] ??= emptyEntry());
  if (entry.evidence.some((e) => e.type === "produced" && e.ref === ref)) return false;
  entry.evidence.push({ type: "produced", ref, date });
  if (!entry.last_produced || date > entry.last_produced) entry.last_produced = date;
  if (entry.coding_level < 1) entry.coding_level = 1;
  return true;
}

/** Manual attestation — the escape hatch. Stored as "claimed", never "produced". */
export function setClaimedLevel(ledger: Ledger, concept: string, level: number): void {
  const entry = (ledger.concepts[concept] ??= emptyEntry());
  const claim: Evidence = { type: "claimed", ref: "manual", date: new Date().toISOString() };
  entry.evidence.push(claim);
  entry.coding_level = Math.max(entry.coding_level, level);
}
