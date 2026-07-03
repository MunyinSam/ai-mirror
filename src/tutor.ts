// Tutor-mode detection (PLAN Stage 3, T0). Pure functions, no I/O, no LLM —
// this runs inside the UserPromptSubmit hook on every prompt, so it must be
// instant and conservative (a false tutor trigger erodes trust; a miss just
// means the weekly report catches it later).
import { effectiveP, isClaimedOnly } from "./ledger.ts";
import type { Ledger } from "./types.ts";

const CODE_INTENT =
  /\b(implement|write|code|coding|function|refactor|fix|bug|build|add|create|script|class|endpoint|api|component|feature|test|debug|scaffold|convert|translate|generate|hook|handler|query|schema|migration)\b/i;

export function hasCodeIntent(prompt: string): boolean {
  return CODE_INTENT.test(prompt);
}

const STOPWORDS = new Set(["the", "and", "with", "using", "into", "from", "your", "for"]);

/** Conservative concept↔prompt match: the full title verbatim, all title
 *  tokens, or all-but-one for long titles. Heuristic by design. */
export function conceptMatches(prompt: string, title: string): boolean {
  const p = prompt.toLowerCase();
  const t = title.toLowerCase();
  if (p.includes(t)) return true;
  const tokens = t.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  if (tokens.length === 0) return false;
  const matched = tokens.filter((w) => p.includes(w)).length;
  return matched === tokens.length || (tokens.length >= 3 && matched >= tokens.length - 1);
}

export interface TutorHit {
  title: string;
  claimedOnly: boolean;
}

/** Concepts mentioned in the prompt whose P is unearned, decayed, or
 *  claimed-only — the ones the tutor should soften generation for. */
export function findBeyondConcepts(prompt: string, ledger: Ledger, cap = 3): TutorHit[] {
  const hits: TutorHit[] = [];
  for (const [title, entry] of Object.entries(ledger.concepts)) {
    const claimedOnly = isClaimedOnly(entry);
    if (effectiveP(entry) > 0 && !claimedOnly) continue;
    if (!conceptMatches(prompt, title)) continue;
    hits.push({ title, claimedOnly });
    if (hits.length >= cap) break;
  }
  return hits;
}

/** The context injected into the conversation. Returns null when there is
 *  nothing to say — the hook then stays completely silent. */
export function buildInjection(hits: TutorHit[], styleDigest: string | null): string | null {
  const parts: string[] = [];

  if (hits.length > 0) {
    const names = hits
      .map((h) => (h.claimedOnly ? `${h.title} (claimed, never verified)` : h.title))
      .join(", ");
    parts.push(
      `<ai-mirror-tutor>
AI Mirror v2 (tutor mode): the user's verified coding ability (P) is unearned or decayed for: ${names}.
- For those parts, default to TUTOR MODE: approach, pseudocode, a skeleton with TODOs, or a failing test — not the finished implementation.
- If the user explicitly asks for the full code anyway, provide it in full, then log the witness: run \`mirror override "<concept>" --reason "<their words, briefly>"\` once per concept.
- Never refuse, never withhold after an explicit request, never lecture beyond one line. A 10-minute alternative always exists: /drill <concept>.
</ai-mirror-tutor>`
    );
  }

  if (styleDigest) {
    parts.push(`<ai-mirror-style>\nMatch the user's personal code style:\n${styleDigest.trim()}\n</ai-mirror-style>`);
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}
