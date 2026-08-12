// Concept embeddings + cosine resolution — the "swap exact-title matching
// for cosine resolution" piece from the plan. Lets a near-miss LLM-proposed
// title ("useState hook") resolve against the real vault title ("React
// Hooks") instead of falling into suggested[] as a false gap.
//
// Local model, not an API: Ollama running nomic-embed-text (768-dim, matches
// concepts.embedding). If OLLAMA_URL isn't set, callers skip this
// entirely and concept resolution stays exact-match only — see the guard
// in classifyAll (classify.ts), not here.
import type { Sql } from "../db/client.ts";

const EMBED_MODEL = "nomic-embed-text";

// Cosine distance (pgvector's `<=>`: 0 = identical, 2 = opposite).
// Tunable, not derived — see docs/schema.md. Calibrated against real
// nomic-embed-text output (see SESSION notes): bare 2-4 word titles alone
// don't separate cleanly — an unrelated pair can land closer than a true
// paraphrase — but title+description pushes true matches to ~0.27-0.31 and
// the nearest false match to ~0.42+, leaving real margin. Requires concepts
// to carry a description; see embedConcept's fallback note below.
export const RESOLVE_DISTANCE_THRESHOLD = 0.35;

/** nomic-embed-text needs a task prefix to embed well: "document" for text
 *  being stored/searched over, "query" for text being resolved against it. */
async function embed(ollamaUrl: string, text: string, task: "document" | "query"): Promise<number[]> {
  const res = await fetch(`${ollamaUrl}/api/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: `search_${task}: ${text}` }),
  });
  if (!res.ok) {
    throw new Error(`ollama embeddings failed: ${res.status} ${await res.text()}`);
  }
  const { embedding } = (await res.json()) as { embedding: number[] };
  return embedding;
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/** Embeds `title` (+ `description` when present) and writes it into
 *  concepts.embedding. Call once a concept is created/synced from the vault
 *  (source is text, embedding is derived — nothing else should write this
 *  column).
 *
 *  The description matters: a bare title alone doesn't carry enough content
 *  for nomic-embed-text to separate true near-misses from unrelated
 *  concepts (measured — see RESOLVE_DISTANCE_THRESHOLD above). A
 *  title-only concept still gets embedded and can still match, but with a
 *  weaker signal than RESOLVE_DISTANCE_THRESHOLD was calibrated against. */
export async function embedConcept(
  ollamaUrl: string,
  sql: Sql,
  conceptId: number,
  title: string,
  description?: string | null
): Promise<void> {
  const text = description ? `${title}: ${description}` : title;
  const vec = await embed(ollamaUrl, text, "document");
  await sql`
    UPDATE concepts SET embedding = ${toVectorLiteral(vec)}::vector, updated_at = now()
    WHERE id = ${conceptId}
  `;
}

/** Resolve a batch of unresolved LLM-proposed titles against the vault by
 *  nearest cosine distance. Returns a map from proposed title -> matched
 *  canonical vault title, present only for matches strictly under
 *  RESOLVE_DISTANCE_THRESHOLD. A title with no close-enough match (or no
 *  embedded concepts to compare against) is simply absent from the map —
 *  callers treat "absent" as "stays a suggestion," never as an error. */
export async function resolveNearMissConcepts(
  ollamaUrl: string,
  sql: Sql,
  proposedTitles: string[]
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  for (const title of new Set(proposedTitles)) {
    const vec = await embed(ollamaUrl, title, "query");
    const [match] = await sql<{ title: string; distance: number }[]>`
      SELECT title, embedding <=> ${toVectorLiteral(vec)}::vector AS distance
      FROM concepts
      WHERE embedding IS NOT NULL
      ORDER BY distance
      LIMIT 1
    `;
    if (match && match.distance < RESOLVE_DISTANCE_THRESHOLD) {
      resolved.set(title, match.title);
    }
  }
  return resolved;
}
