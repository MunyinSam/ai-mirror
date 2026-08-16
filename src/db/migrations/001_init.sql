-- 001_init — the whole store in one migration.
--
-- Design rules encoded here, worth being able to defend:
--
--   1. `events` is the AI provenance log and the ONLY source of truth. Every
--      other table is a derived projection that can be dropped and rebuilt by
--      replaying events + git. That is what makes this event-sourced.
--
--   2. There is no `author` column on events. The old schema had
--      author IN ('ai','you') and nothing ever wrote 'you' — human authorship
--      is not observable at write time, it is DERIVED at commit time by
--      attribution. Storing a column you can never populate is a lie.
--
--   3. `event_uid` is a natural key, not a surrogate one. Ingest inserts with
--      ON CONFLICT DO NOTHING on it, which is what turns an at-least-once
--      queue drain into effectively-once delivery.
--
--   4. Derived quantities the DB can compute are computed BY the DB
--      (see attributions.human_lines) so the invariant cannot drift.

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------- events ---
-- One row per AI write. Appended by ingest, never updated.
CREATE TABLE events (
  id            BIGSERIAL PRIMARY KEY,
  -- sha256(ts | file | code_hash). Deterministic from content, so replaying
  -- the same queue file produces the same uid and collides harmlessly.
  event_uid     TEXT        NOT NULL UNIQUE,
  ts            TIMESTAMPTZ NOT NULL,
  tool          TEXT        NOT NULL,
  session_id    TEXT,
  -- git repo root of the edited file (NOT the shell cwd — in a multi-root
  -- workspace those differ and cwd attributes edits to the wrong repo).
  repo          TEXT        NOT NULL,
  file          TEXT        NOT NULL,
  lang          TEXT        NOT NULL DEFAULT '',

  -- sha256 of after_text. Content-addressed: the classify cache key, so
  -- identical code is never sent to an LLM twice.
  code_hash     TEXT        NOT NULL,

  -- Both sides of the write. `before_text` is what makes accurate line counts
  -- possible: an Edit that changes 1 line inside a 50-line block must count as
  -- 1, and you cannot know that from `after_text` alone.
  before_text   TEXT,
  after_text    TEXT        NOT NULL,

  -- Real diff(before, after), computed at INGEST, never in the hook.
  added_lines   INT         NOT NULL,
  removed_lines INT         NOT NULL,

  -- true when the payload hit the capture cap: line counts are then a floor,
  -- not a measurement, and attribution should not trust the snippet fully.
  truncated     BOOLEAN     NOT NULL DEFAULT false,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX events_ts_idx        ON events (ts);
CREATE INDEX events_code_hash_idx ON events (code_hash);
-- The attribution hot path: "AI events for THIS file, before THIS commit."
-- File-scoping the candidate set is what kills the old global-line-set false
-- positives, and this index is what makes it cheap.
CREATE INDEX events_file_ts_idx   ON events (repo, file, ts);

-- --------------------------------------------------------------- commits ---
CREATE TABLE commits (
  id            BIGSERIAL PRIMARY KEY,
  repo          TEXT        NOT NULL,
  sha           TEXT        NOT NULL,
  ts            TIMESTAMPTZ NOT NULL,
  author_email  TEXT        NOT NULL DEFAULT '',
  subject       TEXT        NOT NULL DEFAULT '',
  -- NULL = not yet attributed. This single nullable column is what makes the
  -- attribution worker resumable and safe to kill mid-run.
  attributed_at TIMESTAMPTZ,
  UNIQUE (repo, sha)
);

CREATE INDEX commits_pending_idx ON commits (repo, ts) WHERE attributed_at IS NULL;

-- ---------------------------------------------------------- attributions ---
-- The answer to "how much of what I shipped did I actually write."
-- One row per (commit, file). Both sides measured against the same denominator
-- — no subtraction, no clamping, no cross-universe arithmetic.
CREATE TABLE attributions (
  id             BIGSERIAL PRIMARY KEY,
  commit_id      BIGINT NOT NULL REFERENCES commits (id) ON DELETE CASCADE,
  file           TEXT   NOT NULL,
  lang           TEXT   NOT NULL DEFAULT '',

  added_lines    INT    NOT NULL CHECK (added_lines >= 0),
  ai_lines       INT    NOT NULL CHECK (ai_lines >= 0),
  -- Generated, not stored by the app: ai + human = added is a schema-level
  -- invariant that no future bug can violate.
  human_lines    INT    GENERATED ALWAYS AS (added_lines - ai_lines) STORED,

  -- Confidence signal: how many AI events were in scope for this file/window.
  -- 0 candidates means "no AI evidence", which is weaker than "proven human".
  candidate_events INT  NOT NULL DEFAULT 0,
  -- Versioned so re-attributing under a new algorithm is auditable.
  method         TEXT   NOT NULL DEFAULT 'run-coalesce/v1',

  UNIQUE (commit_id, file),
  CHECK (ai_lines <= added_lines)
);

-- -------------------------------------------------------- classify_cache ---
-- Keyed by content hash: the cache IS the cost model.
CREATE TABLE classify_cache (
  code_hash  TEXT PRIMARY KEY,
  -- Tier 1: deterministic tree-sitter syntax tags (free).
  tags       TEXT[]      NOT NULL DEFAULT '{}',
  -- Tier 2: concept titles that resolved into the canonical namespace.
  concepts   TEXT[]      NOT NULL DEFAULT '{}',
  -- What the mapper reached for that did NOT resolve — the raw material for
  -- `mirror gaps`. Never mixed into concepts[].
  suggested  TEXT[]      NOT NULL DEFAULT '{}',
  -- false = Tier 2 has not run (e.g. no API key). Backfilled later.
  mapped     BOOLEAN     NOT NULL DEFAULT false,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------- concepts ---
-- The canonical concept namespace. `embedding` enables nearest-concept lookup
-- by cosine distance instead of exact string equality, so "React hooks" and
-- "useState hook" can resolve to one concept.
CREATE TABLE concepts (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT NOT NULL UNIQUE,
  description TEXT,
  confidence  TEXT CHECK (confidence IN ('learning', 'solid', 'fluent')),
  embedding   vector(768),
  source      TEXT        NOT NULL DEFAULT 'vault',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ivfflat is an APPROXIMATE index: it trades recall for latency and must be
-- rebuilt once real rows exist (it trains `lists` centroids on the data
-- present at build time). At this corpus size a seq scan is honestly fine —
-- the index is here for the shape, not the speed. REINDEX after backfill.
CREATE INDEX concepts_embedding_idx ON concepts
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ---------------------------------------------------------------- ledger ---
-- U (understanding) mirrors concepts.confidence at sync time.
-- P (coding_level) is earned only through evidence rows.
-- Decay is computed AT READ TIME in domain/skill.ts and never written back:
-- the stored value is the high-water mark, so changing the decay rule
-- retroactively reinterprets history instead of destroying it.
CREATE TABLE ledger (
  concept_id    BIGINT PRIMARY KEY REFERENCES concepts (id) ON DELETE CASCADE,
  understanding INT         NOT NULL DEFAULT 0 CHECK (understanding BETWEEN 0 AND 3),
  coding_level  INT         NOT NULL DEFAULT 0 CHECK (coding_level BETWEEN 0 AND 4),
  last_produced TIMESTAMPTZ,
  decay_u_days  INT         NOT NULL DEFAULT 180,
  decay_p_days  INT         NOT NULL DEFAULT 45,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------- evidence ---
-- Append-only proof feeding P. The UNIQUE constraint is what makes
-- "credit this commit" idempotent — re-running the crediting pass is free.
CREATE TABLE evidence (
  id         BIGSERIAL PRIMARY KEY,
  concept_id BIGINT      NOT NULL REFERENCES ledger (concept_id) ON DELETE CASCADE,
  type       TEXT        NOT NULL CHECK (type IN ('produced', 'claimed')),
  ref        TEXT        NOT NULL,
  date       TIMESTAMPTZ NOT NULL,
  UNIQUE (concept_id, type, ref)
);

-- --------------------------------------------------------- style_samples ---
-- Verified hand-written code, kept verbatim: the corpus a local model would
-- RAG over or fine-tune from to generate code that sounds like you.
CREATE TABLE style_samples (
  hash       TEXT PRIMARY KEY,
  ts         TIMESTAMPTZ NOT NULL,
  repo       TEXT        NOT NULL,
  file       TEXT        NOT NULL,
  lang       TEXT        NOT NULL,
  code       TEXT        NOT NULL,
  commit_sha TEXT        NOT NULL DEFAULT ''
);

-- ------------------------------------------------------------- overrides ---
-- The witness. When you ask for full code on an unearned concept, the system
-- does not refuse — it records that you chose to. Witness, not wall.
CREATE TABLE overrides (
  id      BIGSERIAL PRIMARY KEY,
  ts      TIMESTAMPTZ NOT NULL DEFAULT now(),
  concept TEXT        NOT NULL,
  reason  TEXT        NOT NULL DEFAULT ''
);
