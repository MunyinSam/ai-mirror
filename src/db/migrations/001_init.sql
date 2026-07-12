-- id — the BIGSERIAL primary key you chose
-- ts — when the event happened (needs a timestamp type — think about timezone-awareness)
-- author — 'ai' or 'you' (consider a CHECK constraint like the old pg-migration.md sketch had)
-- tool — the tool name string, e.g. "Edit", "Write"
-- file — file path string
-- project — repo root path string
-- lang — file extension string, can be empty
-- lines — integer count
-- code_hash — string like "sha256:<hex>"
-- snippet — the truncated code text

CREATE TABLE events (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL,
  author      TEXT NOT NULL CHECK (author IN ('ai', 'you')),
  tool        TEXT NOT NULL,
  file        TEXT NOT NULL,
  project     TEXT NOT NULL,
  lang        TEXT NOT NULL,
  lines       INT NOT NULL,
  code_hash   TEXT NOT NULL,
  snippet     TEXT NOT NULL
);

CREATE INDEX events_ts_idx ON events (ts);
CREATE INDEX events_code_hash_idx ON events (code_hash);

-- concepts — canonical now (replaces vault frontmatter as the source of
-- truth for U). embedding is nomic-embed-text output, 768 dims, used for
-- nearest-concept lookup via cosine distance instead of exact title match.
CREATE TABLE concepts (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT NOT NULL UNIQUE,
  description TEXT,
  confidence  TEXT CHECK (confidence IN ('learning', 'solid', 'fluent')),
  embedding   vector(768),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ivfflat needs rows to train lists on — fine to create now (empty index),
-- but expect to REINDEX once concepts has real data (Phase 4 note).
CREATE INDEX concepts_embedding_idx ON concepts
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ledger — one row per concept. U mirrors concepts.confidence at sync time;
-- P (coding_level) is earned only via evidence rows, decay computed at read
-- time in application code (never destroy the stored value here).
CREATE TABLE ledger (
  concept_id     BIGINT PRIMARY KEY REFERENCES concepts (id) ON DELETE CASCADE,
  understanding  INT NOT NULL DEFAULT 0,
  coding_level   INT NOT NULL DEFAULT 0,
  last_produced  TIMESTAMPTZ,
  decay_u_days   INT NOT NULL DEFAULT 180,
  decay_p_days   INT NOT NULL DEFAULT 45
);

-- evidence — append-only proof feeding P. UNIQUE keeps re-crediting the same
-- commit/ref idempotent, mirroring the old addProducedEvidence guard.
CREATE TABLE evidence (
  id         BIGSERIAL PRIMARY KEY,
  concept_id BIGINT NOT NULL REFERENCES ledger (concept_id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('produced', 'claimed')),
  ref        TEXT NOT NULL,
  date       TIMESTAMPTZ NOT NULL,
  UNIQUE (concept_id, type, ref)
);
