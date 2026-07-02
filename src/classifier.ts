// The tiered classifier (CONCEPTS §9). Runs at report time, never in the hook.
//   Tier 1: tree-sitter syntax tags — deterministic, free, always runs.
//   Tier 2: batched LLM mapping to vault concept titles — only for uncached
//           hashes, only when an API key is present.
// Results are cached by code_hash; unchanged code is never re-sent.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Language, Parser, Query } from "web-tree-sitter";
import Anthropic from "@anthropic-ai/sdk";
import { REPO_ROOT } from "./config.ts";
import type { CacheEntry, ClassifyCache } from "./types.ts";

const WASM_DIR = resolve(REPO_ROOT, "node_modules");

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

const CLASSIFY_MODEL = "claude-haiku-4-5";
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

export function loadCache(cachePath: string): ClassifyCache {
  if (!existsSync(cachePath)) return {};
  try {
    return JSON.parse(readFileSync(cachePath, "utf8")) as ClassifyCache;
  } catch {
    return {};
  }
}

export function saveCache(cachePath: string, cache: ClassifyCache): void {
  writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf8");
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
}

/** Tier 2: one batched call per BATCH_SIZE snippets, structured output via a
 *  forced tool so the response is typed JSON, never free text. */
async function mapBatchToVaultConcepts(
  client: Anthropic,
  batch: ClassifyInput[],
  tagsByHash: Map<string, string[]>,
  vaultTitles: string[]
): Promise<Map<string, string[]>> {
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

Vault concepts:
${vaultTitles.join(", ")}

${numbered}`,
      },
    ],
  });

  const block = response.content.find((b) => b.type === "tool_use");
  const results =
    (block?.type === "tool_use"
      ? (block.input as { results?: { index: number; concepts: string[] }[] }).results
      : undefined) ?? [];

  const titleSet = new Set(vaultTitles);
  const out = new Map<string, string[]>();
  for (const r of results) {
    const item = batch[r.index];
    if (!item) continue;
    // Enforce the canonical namespace: only exact vault titles survive.
    out.set(item.code_hash, [...new Set(r.concepts.filter((c) => titleSet.has(c)))]);
  }
  return out;
}

/** Classify every input not already cached; mutates and persists the cache.
 *  Without an API key this still produces tags (concepts stay empty). */
export async function classifyAll(
  cachePath: string,
  inputs: ClassifyInput[],
  vaultTitles: string[]
): Promise<{ cache: ClassifyCache; stats: ClassifyStats }> {
  const cache = loadCache(cachePath);
  const stats: ClassifyStats = { cached: 0, tagged: 0, llmMapped: 0, apiCalls: 0 };

  const apiKey = process.env["ANTHROPIC_API_KEY"];

  // Dedupe by hash; skip legacy hashes (no code to classify). Entries cached
  // before an API key existed (mapped: false) are retried for Tier 2.
  const pending = new Map<string, ClassifyInput>();
  for (const input of inputs) {
    const cached = cache[input.code_hash];
    const needsBackfill = cached && !cached.mapped && apiKey;
    if (cached && !needsBackfill) {
      stats.cached++;
    } else if (input.snippet && !input.code_hash.startsWith("legacy:")) {
      pending.set(input.code_hash, input);
    }
  }
  if (pending.size === 0) return { cache, stats };

  // Tier 1 for everything pending (reuse cached tags on backfill)
  const tagsByHash = new Map<string, string[]>();
  for (const item of pending.values()) {
    const cachedTags = cache[item.code_hash]?.tags;
    tagsByHash.set(item.code_hash, cachedTags ?? (await getSyntaxTags(item.snippet, item.lang)));
    stats.tagged++;
  }

  // Tier 2 only with a key and a vault
  const conceptsByHash = new Map<string, string[]>();
  let tier2Ran = false;
  if (apiKey && vaultTitles.length > 0) {
    tier2Ran = true;
    const client = new Anthropic({ apiKey });
    const items = [...pending.values()];
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      try {
        const mapped = await mapBatchToVaultConcepts(client, batch, tagsByHash, vaultTitles);
        for (const [hash, concepts] of mapped) conceptsByHash.set(hash, concepts);
        stats.apiCalls++;
        stats.llmMapped += mapped.size;
      } catch (err) {
        // A failed batch stays uncached and will retry next run.
        console.error(`⚠ classify batch failed: ${(err as Error).message}`);
        for (const item of batch) pending.delete(item.code_hash);
      }
    }
  }

  const now = new Date().toISOString();
  for (const item of pending.values()) {
    const entry: CacheEntry = {
      tags: tagsByHash.get(item.code_hash) ?? [],
      concepts: conceptsByHash.get(item.code_hash) ?? [],
      mapped: tier2Ran,
      ts: now,
    };
    cache[item.code_hash] = entry;
  }
  saveCache(cachePath, cache);
  return { cache, stats };
}
