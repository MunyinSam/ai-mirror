// The v3 gate (CONCEPTS §7) — a git pre-commit ADVISORY, the universal net.
// It assesses everything staged regardless of who wrote it (Claude Code,
// Copilot, a browser paste, your hands), so the Mirror's write-time blind
// spots don't survive to commit time. It never blocks and always fails open:
// pure functions here, all git/LLM I/O in commands/gate.ts.
import { effectiveP, isClaimedOnly } from "./ledger.ts";
import { buildAiLineSet, significant, type AddedHunk } from "./handwritten.ts";
import { langOf, sha256 } from "./util.ts";
import { CODE_LANGS, type ClassifyCache, type Ledger, type MirrorEvent } from "./types.ts";
import type { ClassifyInput } from "./classifier.ts";

/** Hunks smaller than this are too thin to classify meaningfully. */
const MIN_HUNK_LINES = 3;

/** Staged added hunks worth assessing: code files only, big enough to mean
 *  something. Unlike handwrittenHunks, AI-matched hunks stay in — the gate
 *  judges the code entering the commit, not its author. */
export function stagedCodeHunks(hunks: AddedHunk[]): AddedHunk[] {
  return hunks.filter(
    (h) =>
      CODE_LANGS.has(langOf(h.file)) &&
      !h.file.includes("node_modules/") &&
      h.lines.length >= MIN_HUNK_LINES
  );
}

/** Classifier inputs for staged hunks. Hashing the hunk text means a re-commit
 *  of the same code (amend, split, retry) hits the cache and costs nothing. */
export function hunkInputs(hunks: AddedHunk[]): ClassifyInput[] {
  return hunks.map((h) => {
    const code = h.lines.join("\n");
    return { code_hash: sha256(code), snippet: code, lang: langOf(h.file) };
  });
}

/** Share of staged significant lines that match the AI snippet log — the
 *  provenance split of what's about to be committed. Null when the staged
 *  diff has no significant lines to judge. */
export function stagedAiPct(hunks: AddedHunk[], events: MirrorEvent[]): number | null {
  const aiLines = buildAiLineSet(events);
  let total = 0;
  let matched = 0;
  for (const h of hunks) {
    for (const line of h.lines) {
      if (!significant(line)) continue;
      total++;
      if (aiLines.has(line.trim())) matched++;
    }
  }
  return total === 0 ? null : Math.round((matched / total) * 100);
}

export interface GateAssessment {
  /** vault concepts in the staged diff with unearned or decayed P */
  beyond: string[];
  /** vault concepts whose P rests solely on manual claims */
  claimedOnly: string[];
  /** vault concepts backed by fresh verified P */
  within: string[];
  /** concepts the classifier reached for that aren't in the vault */
  unfiled: string[];
  /** true when at least one staged hunk got a Tier-2 (LLM) verdict — without
   *  it the gate has nothing trustworthy to say and must stay quiet */
  assessed: boolean;
}

/** Judge the staged diff's concepts against the ledger. A concept missing
 *  from the ledger is beyond by definition — P is earned, never assumed. */
export function assessStaged(
  inputs: ClassifyInput[],
  cache: ClassifyCache,
  ledger: Ledger
): GateAssessment {
  const beyond = new Set<string>();
  const claimedOnly = new Set<string>();
  const within = new Set<string>();
  const unfiled = new Set<string>();
  let assessed = false;

  for (const input of inputs) {
    const entry = cache[input.code_hash];
    if (!entry?.mapped) continue;
    assessed = true;
    for (const s of entry.suggested ?? []) unfiled.add(s);
    for (const concept of entry.concepts) {
      const led = ledger.concepts[concept];
      if (!led || effectiveP(led) === 0) beyond.add(concept);
      else if (isClaimedOnly(led)) claimedOnly.add(concept);
      else within.add(concept);
    }
  }

  return {
    beyond: [...beyond].sort(),
    claimedOnly: [...claimedOnly].sort(),
    within: [...within].sort(),
    unfiled: [...unfiled].sort(),
    assessed,
  };
}
