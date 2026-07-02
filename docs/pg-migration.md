# Postgres migration path (Mac mini future)

Everything on disk is flat, typed JSON — moving to Postgres is one importer
script, no schema redesign. Do this only when the Mac mini (local LLM +
storage DB) exists; files are faster to inspect and plenty fast at current scale.

## Table DDL

```sql
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
CREATE INDEX events_project_idx ON events (project);

CREATE TABLE classify_cache (
  code_hash   TEXT PRIMARY KEY,
  tags        TEXT[] NOT NULL,
  concepts    TEXT[] NOT NULL,
  mapped      BOOLEAN NOT NULL,
  ts          TIMESTAMPTZ NOT NULL
);

CREATE TABLE ledger (
  concept        TEXT PRIMARY KEY,
  understanding  INT NOT NULL,
  coding_level   INT NOT NULL,
  last_produced  TIMESTAMPTZ,
  decay_u_days   INT NOT NULL,
  decay_p_days   INT NOT NULL
);

CREATE TABLE evidence (
  id       BIGSERIAL PRIMARY KEY,
  concept  TEXT NOT NULL REFERENCES ledger (concept),
  type     TEXT NOT NULL CHECK (type IN ('produced', 'claimed')),
  ref      TEXT NOT NULL,
  date     TIMESTAMPTZ NOT NULL,
  UNIQUE (concept, type, ref)
);

CREATE TABLE style_samples (
  hash      TEXT PRIMARY KEY,   -- sha256 of code, same dedupe key as JSONL
  ts        TIMESTAMPTZ NOT NULL,
  project   TEXT NOT NULL,
  file      TEXT NOT NULL,
  lang      TEXT NOT NULL,
  code      TEXT NOT NULL,
  concepts  TEXT[] NOT NULL,
  commit    TEXT NOT NULL
);
```

## Importer sketch

Read each JSONL/JSON file under the data dir (`mirror.config.json` →
`data_dir`) and bulk-insert:

- `events.jsonl` → `events` (drop the `v` field)
- `classify-cache.json` → `classify_cache` (object keys become `code_hash`)
- `skills.json` → `ledger` + `evidence` (flatten the `evidence` array)
- `style/samples.jsonl` → `style_samples`

The style corpus (`style_samples.code`) is the table a local LLM would RAG
over or fine-tune from — full snippets are kept verbatim for exactly that.
