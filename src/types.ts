// Single source of truth for cross-layer shapes. Mirrors the Postgres schema
// in src/db/migrations/001_init.sql — these are the JS-side views of the
// same rows, kept flat and JSON-serializable on purpose.

/** Languages the classifier & attributor understand. Everything else
 *  (markdown, JSON, configs) is captured but never concept-classified, and
 *  excluded from line-attribution denominators. */
export const CODE_LANGS = new Set(["ts", "tsx", "js", "jsx", "py"]);

export const SNIPPET_CAP = 32 * 1024;

/** Path fragments excluded from BOTH numerator and denominator of every line
 *  count. Applying this to human lines too (not just AI lines) is what stops
 *  a vendored bundle or a lockfile from silently inflating "lines you wrote". */
export const EXCLUDED_PATH_PATTERNS = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /\.min\.[jt]s$/,
  /(^|\/)vendor\//,
  /package-lock\.json$/,
  /bun\.lock$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /(^|\/)__snapshots__\//,
];

export function isExcludedPath(file: string): boolean {
  return EXCLUDED_PATH_PATTERNS.some((re) => re.test(file));
}

/** Raw shape written by the capture hook into the local queue file — the
 *  wire format between capture and ingest. Deliberately NOT the `events`
 *  table row: ingest derives added_lines/removed_lines/event_uid from this. */
export interface QueuedEvent {
  ts: string;
  tool: string;
  session_id?: string;
  repo: string;
  file: string;
  lang: string;
  code_hash: string;
  before_text: string | null;
  after_text: string;
  truncated: boolean;
}

export interface EventRow {
  id: number;
  event_uid: string;
  ts: string;
  tool: string;
  session_id: string | null;
  repo: string;
  file: string;
  lang: string;
  code_hash: string;
  before_text: string | null;
  after_text: string;
  added_lines: number;
  removed_lines: number;
  truncated: boolean;
}

export interface CommitRow {
  id: number;
  repo: string;
  sha: string;
  ts: string;
  author_email: string;
  subject: string;
  attributed_at: string | null;
}

export interface AttributionRow {
  id: number;
  commit_id: number;
  file: string;
  lang: string;
  added_lines: number;
  ai_lines: number;
  human_lines: number;
  candidate_events: number;
  method: string;
}

export interface Evidence {
  type: "produced" | "claimed";
  ref: string;
  date: string;
}

export interface LedgerEntry {
  concept: string;
  understanding: number;
  coding_level: number;
  last_produced: string | null;
  decay_days: { u: number; p: number };
  evidence: Evidence[];
}

export const DEFAULT_DECAY = { u: 180, p: 45 };
