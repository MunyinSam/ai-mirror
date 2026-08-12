// The tiered classifier (stage 7). Runs at report/backfill time, never in
// the capture hook.
//   Tier 1: tree-sitter syntax tags — deterministic, free, always runs.
//   Tier 2: batched Haiku calls mapping code -> vault concept titles — only
//           for uncached hashes, only when ANTHROPIC_API_KEY is set.
// Cached by code_hash in the `classify_cache` table (schema in
// 001_init.sql), so identical code is never sent to an LLM twice.
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { Language, Parser, Query } from "web-tree-sitter";
import type { Sql } from "../db/client.ts";
import { resolveNearMissConcepts } from "./embed.ts";
import { CODE_LANGS, type ClassifyCacheRow } from "../types.ts";

const WASM_DIR = resolve(import.meta.dir, "..", "..", "node_modules");

// No separate JS grammar is installed — the TypeScript grammar parses JS fine.
const GRAMMARS: Record<string, string> = {
  ts: `${WASM_DIR}/tree-sitter-typescript/tree-sitter-typescript.wasm`,
  js: `${WASM_DIR}/tree-sitter-typescript/tree-sitter-typescript.wasm`,
  tsx: `${WASM_DIR}/tree-sitter-typescript/tree-sitter-tsx.wasm`,
  jsx: `${WASM_DIR}/tree-sitter-typescript/tree-sitter-tsx.wasm`,
  py: `${WASM_DIR}/tree-sitter-python/tree-sitter-python.wasm`,
};

const TS_QUERY = `
  (await_expression) @async_await
  (arrow_function) @arrow_function
  (decorator) @decorator
  (try_statement) @try_catch
  (class_declaration) @class
  (interface_declaration) @interface
  (type_alias_declaration) @type_alias
  (generic_type) @generics
`;

const PY_QUERY = `
  (await) @async_await
  (decorated_definition) @decorator
  (try_statement) @try_catch
  (class_definition) @class
  (lambda) @lambda
  (list_comprehension) @comprehension
  (generator_expression) @comprehension
`;

const CLASSIFY_MODEL = "claude-haiku-4-5-20251001";
const BATCH_SIZE = 15;
const SNIPPET_PROMPT_CAP = 800;

let initialized = false;
const langCache = new Map<string, Language>();

async function getLanguage(lang: string): Promise<Language | null> {
  const wasmPath = GRAMMARS[lang];
  if (!wasmPath) return null;
  if (!initialized) {
    await Parser.init({
      locateFile: () => `${WASM_DIR}/web-tree-sitter/web-tree-sitter.wasm`,
    });
    initialized = true;
  }
  let cached = langCache.get(wasmPath);
  if (!cached) {
    cached = await Language.load(wasmPath);
    langCache.set(wasmPath, cached);
  }
  return cached;
}

/** Tier 1: deterministic syntax tags. Returns [] for unsupported languages. */
export async function getSyntaxTags(code: string, lang: string): Promise<string[]> {
  const language = await getLanguage(lang);
  if (!language) return [];
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(code);
  if (!tree) return [];
  const query = new Query(language, lang === "py" ? PY_QUERY : TS_QUERY);
  const matches = query.matches(tree.rootNode);
  return [...new Set(matches.flatMap((m) => m.captures.map((c) => c.name)))];
}

/** ★ YOU ARE WRITING THIS. Walkthrough in chat.
 *
 *  Tier 2's filter: enforce the canonical concept namespace against one
 *  snippet's raw LLM proposal ("LLM proposes, canonical namespace
 *  disposes" — ported from the old classifier.ts:182-194 pattern). The LLM
 *  is free-associating title strings; this function is the only thing that
 *  decides which of them actually count.
 *
 *  - `proposed`: concept titles the LLM claimed this snippet uses.
 *  - `proposedUnfiled`: concept names the LLM reached for that it flagged as
 *    NOT already in the vault (candidate material for `mirror gaps`).
 *  - `vaultTitles`: the canonical namespace — every title actually filed in
 *    `concepts`.
 *
 *  Return `concepts`: only entries of `proposed` that exact-match a title in
 *  `vaultTitles`, deduplicated. Anything the LLM proposed that ISN'T in the
 *  vault must NOT end up in `concepts` — that's the whole point of this
 *  function; a hallucinated or near-miss title should never silently create
 *  ledger credit for a concept that was never actually filed.
 *
 *  Return `suggested`: entries of `proposedUnfiled`, deduplicated, but ALSO
 *  filtered against `vaultTitles` — if the LLM's "unfiled" guess actually
 *  matches a real vault title, it isn't a gap, so drop it from `suggested`
 *  too (it should probably already be in `concepts` instead).
 */
export function resolveConcepts(
  proposed: string[],
  proposedUnfiled: string[],
  vaultTitles: Set<string>
): { concepts: string[]; suggested: string[] } {
  return {
    concepts: [...new Set(proposed.filter((c) => vaultTitles.has(c)))],
    suggested: [...new Set(proposedUnfiled.filter((c) => !vaultTitles.has(c)))],
  };
}

export interface ClassifyInput {
  code_hash: string;
  snippet: string;
  lang: string;
}

export interface ClassifyStats {
  cached: number;
  tagged: number;
  llmMapped: number;
  apiCalls: number;
  /** suggested titles that resolved to a real vault concept via cosine
   *  distance instead of falling into suggested[] as a false gap. */
  nearMissResolved: number;
}

export interface ClassifyOpts {
  /** per-request cap for callers that must stay fast — a timed-out batch
   *  stays uncached and retries at the next run. */
  timeoutMs?: number;
  maxRetries?: number;
}

/** One batched call per BATCH_SIZE snippets, structured output via a forced
 *  tool so the response is typed JSON, never free text. Applies
 *  resolveConcepts() to every result before returning. */
async function mapBatchToVaultConcepts(
  client: Anthropic,
  batch: ClassifyInput[],
  tagsByHash: Map<string, string[]>,
  vaultTitleSet: Set<string>,
  vaultTitles: string[]
): Promise<Map<string, { concepts: string[]; suggested: string[] }>> {
  const numbered = batch
    .map(
      (item, i) =>
        `--- snippet ${i} (lang: ${item.lang || "unknown"}; syntax: ${
          (tagsByHash.get(item.code_hash) ?? []).join(", ") || "none"
        }) ---\n${item.snippet.slice(0, SNIPPET_PROMPT_CAP)}`
    )
    .join("\n\n");

  const response = await client.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 2048,
    tools: [
      {
        name: "record_concepts",
        description:
          "Record which knowledge-vault concepts each code snippet uses or requires understanding of.",
        input_schema: {
          type: "object" as const,
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer" },
                  concepts: { type: "array", items: { type: "string" } },
                  unfiled: {
                    type: "array",
                    items: { type: "string" },
                    description:
                      "short canonical names of concepts the snippet clearly uses that are NOT in the vault list",
                  },
                },
                required: ["index", "concepts"],
              },
            },
          },
          required: ["results"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "record_concepts" },
    messages: [
      {
        role: "user",
        content: `For each numbered code snippet below, list which of these vault concepts it uses or requires understanding of. Use the concept titles EXACTLY as written. Use an empty list when none apply — do not stretch.

Additionally: if a snippet clearly rests on a significant concept that is NOT in the vault list, name it in "unfiled" (short canonical name, e.g. "Python Decorator Factory"). At most the 2 most significant per snippet. Only concepts worth a study session — patterns, techniques, architectures. NEVER language basics or single built-ins (string interpolation, imports, Object.fromEntries, type annotations, etc.).

Vault concepts:
${vaultTitles.length > 0 ? vaultTitles.join(", ") : "(vault is empty — everything significant goes in unfiled)"}

${numbered}`,
      },
    ],
  });

  const block = response.content.find((b) => b.type === "tool_use");
  const results =
    (block?.type === "tool_use"
      ? (block.input as { results?: { index: number; concepts: string[]; unfiled?: string[] }[] })
          .results
      : undefined) ?? [];

  const out = new Map<string, { concepts: string[]; suggested: string[] }>();
  for (const r of results) {
    const item = batch[r.index];
    if (!item) continue;
    out.set(item.code_hash, resolveConcepts(r.concepts, r.unfiled ?? [], vaultTitleSet));
  }
  return out;
}

async function loadCached(sql: Sql, hashes: string[]): Promise<Map<string, ClassifyCacheRow>> {
  if (hashes.length === 0) return new Map();
  const rows = await sql<ClassifyCacheRow[]>`
    SELECT code_hash, tags, concepts, suggested, mapped, ts
    FROM classify_cache WHERE code_hash IN ${sql(hashes)}
  `;
  return new Map(rows.map((r) => [r.code_hash, r]));
}

async function upsertCache(sql: Sql, entries: ClassifyCacheRow[]): Promise<void> {
  for (const e of entries) {
    await sql`
      INSERT INTO classify_cache (code_hash, tags, concepts, suggested, mapped, ts)
      VALUES (${e.code_hash}, ${e.tags}, ${e.concepts}, ${e.suggested}, ${e.mapped}, ${e.ts})
      ON CONFLICT (code_hash) DO UPDATE SET
        tags = EXCLUDED.tags, concepts = EXCLUDED.concepts,
        suggested = EXCLUDED.suggested, mapped = EXCLUDED.mapped, ts = EXCLUDED.ts
    `;
  }
}

/** Classify every input not already cached (Tier 1 always, Tier 2 only with
 *  an API key), persisting results into `classify_cache`. Entries cached
 *  before a key existed (`mapped: false`) are retried for Tier 2 on a later
 *  run — that's the "second run makes zero API calls" property for anything
 *  that already succeeded, while backfill-without-a-key still stays useful. */
export async function classifyAll(
  sql: Sql,
  inputs: ClassifyInput[],
  vaultTitles: string[],
  opts: ClassifyOpts = {}
): Promise<ClassifyStats> {
  const stats: ClassifyStats = {
    cached: 0,
    tagged: 0,
    llmMapped: 0,
    apiCalls: 0,
    nearMissResolved: 0,
  };
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  const ollamaUrl = process.env["OLLAMA_URL"];

  const byHash = new Map(inputs.map((i) => [i.code_hash, i]));
  const cache = await loadCached(sql, [...byHash.keys()]);

  const pending = new Map<string, ClassifyInput>();
  const toWrite: ClassifyCacheRow[] = [];
  const now0 = new Date().toISOString();
  for (const input of byHash.values()) {
    const cached = cache.get(input.code_hash);
    const needsBackfill = cached && !cached.mapped && apiKey;
    if (cached && !needsBackfill) {
      stats.cached++;
    } else if (!CODE_LANGS.has(input.lang)) {
      // Docs/configs are provenance-logged but never concept-classified;
      // cache a terminal empty entry so they don't churn every run.
      toWrite.push({
        code_hash: input.code_hash,
        tags: [],
        concepts: [],
        suggested: [],
        mapped: true,
        ts: now0,
      });
    } else if (input.snippet && !input.code_hash.startsWith("legacy:")) {
      pending.set(input.code_hash, input);
    }
  }

  if (pending.size > 0) {
    // Tier 1 for everything pending (reuse cached tags on backfill).
    const tagsByHash = new Map<string, string[]>();
    for (const item of pending.values()) {
      const cachedTags = cache.get(item.code_hash)?.tags;
      tagsByHash.set(item.code_hash, cachedTags ?? (await getSyntaxTags(item.snippet, item.lang)));
      stats.tagged++;
    }

    // Tier 2 with a key — even against an empty vault, so unfiled
    // suggestions still flow (that's how a fresh vault learns what it's
    // missing).
    const mappedByHash = new Map<string, { concepts: string[]; suggested: string[] }>();
    let tier2Ran = false;
    if (apiKey) {
      tier2Ran = true;
      const vaultTitleSet = new Set(vaultTitles);
      const client = new Anthropic({
        apiKey,
        timeout: opts.timeoutMs,
        maxRetries: opts.maxRetries,
      });
      const items = [...pending.values()];
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        try {
          const mapped = await mapBatchToVaultConcepts(
            client,
            batch,
            tagsByHash,
            vaultTitleSet,
            vaultTitles
          );
          for (const [hash, result] of mapped) mappedByHash.set(hash, result);
          stats.apiCalls++;
          stats.llmMapped += mapped.size;
        } catch (err) {
          // A failed batch stays uncached and will retry next run.
          console.error(`classify batch failed: ${(err as Error).message}`);
          for (const item of batch) pending.delete(item.code_hash);
        }
      }
    }

    // Cosine resolution: a suggestion that's actually a paraphrase of a
    // real vault title ("useState hook" vs "React Hooks") gets promoted
    // into concepts instead of sitting in suggested[] as a false gap.
    // Best-effort — a network hiccup here must not fail the whole run,
    // since exact-match classification already succeeded.
    if (ollamaUrl) {
      const allSuggested = [...mappedByHash.values()].flatMap((m) => m.suggested);
      if (allSuggested.length > 0) {
        try {
          const resolved = await resolveNearMissConcepts(ollamaUrl, sql, allSuggested);
          for (const result of mappedByHash.values()) {
            const stillSuggested: string[] = [];
            for (const title of result.suggested) {
              const match = resolved.get(title);
              if (match) {
                if (!result.concepts.includes(match)) result.concepts.push(match);
                stats.nearMissResolved++;
              } else {
                stillSuggested.push(title);
              }
            }
            result.suggested = stillSuggested;
          }
        } catch (err) {
          console.error(`near-miss resolution failed: ${(err as Error).message}`);
        }
      }
    }

    const now = new Date().toISOString();
    for (const item of pending.values()) {
      const mapped = mappedByHash.get(item.code_hash);
      toWrite.push({
        code_hash: item.code_hash,
        tags: tagsByHash.get(item.code_hash) ?? [],
        concepts: mapped?.concepts ?? [],
        suggested: mapped?.suggested ?? [],
        mapped: tier2Ran,
        ts: now,
      });
    }
  }

  if (toWrite.length > 0) await upsertCache(sql, toWrite);
  return stats;
}
