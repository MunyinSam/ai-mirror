// Single source of truth for every schema in the system.
// All shapes are flat and JSON-serializable so they port to Postgres unchanged
// (see docs/pg-migration.md).

/** One provenance event, appended by the hook. The log is append-only and
 *  immutable — classification results live in the cache, never here. */
export interface MirrorEvent {
  v: 2;
  ts: string;
  author: "ai" | "you";
  tool: string;
  file: string;
  project: string;
  /** file extension without the dot, e.g. "ts", "py"; "" if none */
  lang: string;
  lines: number;
  /** "sha256:<hex>" of the full written code; "legacy:<n>" for migrated v1 rows */
  code_hash: string;
  /** raw written code, truncated to SNIPPET_CAP bytes */
  snippet: string;
}

export const SNIPPET_CAP = 8 * 1024;

/** Classification result for one code_hash. Tier 1 = tags, Tier 2 = concepts. */
export interface CacheEntry {
  /** deterministic tree-sitter syntax tags */
  tags: string[];
  /** vault note titles only (canonical concept namespace) */
  concepts: string[];
  ts: string;
}

export type ClassifyCache = Record<string, CacheEntry>;

export interface Evidence {
  /** "produced" = verified hand-written code; "claimed" = manual attestation */
  type: "produced" | "claimed";
  /** e.g. "commit:abc1234" or "manual" */
  ref: string;
  date: string;
}

export interface LedgerEntry {
  /** U 0-3, mirrored from the vault's confidence frontmatter on every sync */
  understanding: number;
  /** stored P — highest verified level; effective P is computed at read time */
  coding_level: number;
  last_produced: string | null;
  decay_days: { u: number; p: number };
  evidence: Evidence[];
}

export interface Ledger {
  updated: string;
  concepts: Record<string, LedgerEntry>;
}

export const DEFAULT_DECAY = { u: 180, p: 45 };

/** One verified hand-written code sample feeding the style corpus. */
export interface StyleSample {
  ts: string;
  project: string;
  file: string;
  lang: string;
  code: string;
  concepts: string[];
  commit: string;
  /** sha256 of code — dedupe key */
  hash: string;
}
