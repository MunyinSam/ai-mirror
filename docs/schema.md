# Database schema

One migration, `src/db/migrations/001_init.sql`. Nine tables. This walks
through what each one is for and why it's shaped the way it is — the "why"
comments in the SQL file itself are the terse version of this.

## The core idea: one source of truth, everything else derived

`events` is the only table that isn't computable from something else. Every
other table is a **projection** — it can be dropped and rebuilt by replaying
`events` plus the real git history. That's what "event-sourced" means here:
if the attribution algorithm changes, you don't migrate data, you just
re-derive it.

```
events  ──┐
          ├──(attribution)──▶ commits, attributions
git log ──┘

events ──(classification)──▶ classify_cache ──▶ concepts, ledger, evidence
```

## `events` — the provenance log

One row per AI-authored write (every `PostToolUse` from Claude Code editing
a file). Append-only, never updated.

| column | why it's there |
|---|---|
| `event_uid` | `sha256(ts \| file \| code_hash)` — a *natural* key, not a surrogate one. Ingest inserts with `ON CONFLICT (event_uid) DO NOTHING`, which is the whole idempotency mechanism: replaying the same queue file twice inserts the same rows once. |
| `repo` | the file's git root at capture time, **not** the shell's cwd — in a multi-root workspace those differ, and cwd would attribute the edit to the wrong project. |
| `code_hash` | `sha256(after_text)`. Content-addressed, and reused as the `classify_cache` key — identical code is classified once no matter how many times it's written. |
| `before_text` / `after_text` | both sides of the write. `before` is what makes accurate line counts possible: editing 1 line inside a 50-line block must count as 1 changed line, and you can't tell that from `after` alone. |
| `added_lines` / `removed_lines` | a real diff of before/after, computed at **ingest**, never in the hook — the hook has to be fast and cannot fail, so it does zero computation. |
| `truncated` | true if the payload hit the capture size cap. When true, the line counts are a floor, not a fact — attribution treats truncated snippets more skeptically. |

Notably absent: there is **no `author` column**. The old schema had one
(`'ai' \| 'you'`) and nothing ever wrote `'you'` — human authorship isn't
observable at write time, only AI writes get captured. Storing a column you
can never populate the other value of is just a lie sitting in the schema.
Human authorship is *derived*, at commit time, by attribution.

## `commits` — one row per git commit, per repo you've worked in

Populated by discovery (walking `git log`), not by the hook. The only
mutable column is `attributed_at`:

- `NULL` = not yet attributed.
- non-null = attribution has run for this commit.

That single nullable column is what makes the attribution worker resumable:
it can be killed mid-run at any point and just re-query
`WHERE attributed_at IS NULL` (there's a partial index for exactly this,
`commits_pending_idx`) to pick up where it left off, with no separate
progress-tracking mechanism needed.

## `attributions` — the actual answer

One row per `(commit, file)`. This is the table `mirror report` reads.

- `added_lines` and `ai_lines` are both measured against the **same
  denominator** — the lines git says this commit added to this file. No
  subtraction across different universes of "lines the AI touched" vs.
  "lines in the file," which is the bug the old handwritten Set-based
  version had.
- `human_lines` is a **generated column** (`added_lines - ai_lines`, `STORED`),
  not something the application computes and writes. That makes
  `ai + human = added` a schema-level invariant — no future bug in
  application code can ever violate it, because Postgres computes it.
- `candidate_events` is a confidence signal, not part of the ratio: how many
  AI events were even in scope (same file, same time window) for this
  commit. Zero candidates means "no AI evidence found," which is weaker than
  "proven human" — the report can distinguish those two cases even though
  both currently show `ai_lines = 0`.
- `method` is a version string (`'run-coalesce/v1'`) so that if the matching
  algorithm changes later, you can tell which rows were computed under which
  rule, and selectively re-attribute.

## `classify_cache` — the cost model

Keyed by `code_hash` (the same hash as `events.code_hash`). This table's
entire reason to exist is: **never send the same code to an LLM twice.**

- `tags` — Tier 1, deterministic tree-sitter syntax tags (async/await,
  decorators, try/catch, ...). Free, always computed, no API involved.
- `concepts` — Tier 2, concept titles a Haiku call mapped this code to, that
  survived the canonical-namespace filter (see `resolveConcepts` in
  `src/enrich/classify.ts`) — i.e. titles that actually exist in `concepts`.
- `suggested` — the raw material for `mirror gaps`: concepts the LLM
  reached for that *aren't* in the vault yet. Deliberately kept separate
  from `concepts` — a suggestion is not credit.
- `mapped` — `false` means Tier 2 hasn't run yet (e.g. no API key was set
  at classification time). A later run with a key backfills these rows
  instead of skipping them, which is why cache lookups check `mapped`, not
  just presence of a row.

## `concepts` — the canonical namespace

The vault of things you're tracking skill against, mirrored into Postgres
from Obsidian (or wherever `source` says it came from).

- `title` is `UNIQUE` and is the string every other table's concept
  references resolve against.
- `embedding vector(768)` exists so that a near-miss title from the
  classifier (e.g. "useState hook" proposed against a vault entry titled
  "React Hooks") can resolve by cosine distance instead of needing an exact
  string match. Not wired up yet — stage 7's classifier still does exact
  matching; stage 8 is specifically "make this column do something."
- The `ivfflat` index on `embedding` is an **approximate** nearest-neighbor
  index — it trades recall for speed by training cluster centroids
  (`lists = 100`) on whatever data exists when the index is built. At this
  corpus's current size a sequential scan is fast enough anyway; the index
  is here for the shape of the eventual query, and needs a `REINDEX` once
  there's a real backfilled corpus to train on.

## `ledger` — the skill scoreboard

One row per concept (`concept_id` is both the primary key and the FK — a
1:1 extension of `concepts`, not a separate identity).

- `understanding` (U) and `coding_level` (P) are two different axes: U is
  "can I explain it," P is "can I produce it unaided." U mirrors
  `concepts.confidence` when synced from the vault; P is earned *only*
  through rows in `evidence` — you can't self-report your way to P.
- `last_produced` plus `decay_u_days`/`decay_p_days` feed the decay
  calculation, but **the stored `coding_level` never changes.** Decay is
  computed at read time in `src/domain/skill.ts` (`effectiveP`). Storing the
  undecayed high-water mark and reinterpreting it at read time is what lets
  the decay *rule* change later without destroying history — if you
  loosen or tighten the decay window next year, every past ledger entry
  reinterprets correctly instead of needing a backfill.

## `evidence` — the append-only proof feeding P

- `type` is `'produced'` (you shipped a commit using this concept, verified
  by attribution), `'session'` (a tutor session fired for this concept and
  you didn't override it — written by the Stop hook, never verified against
  a real commit, so weaker than `'produced'` but stronger than a bare
  claim), or `'claimed'` (you said you know it, unverified — see
  `isClaimedOnly` in `skill.ts`, which flags ledger entries that rest
  *only* on claims and treats both `'produced'` and `'session'` as real
  evidence).
- `UNIQUE (concept_id, type, ref)` is what makes "credit this commit" an
  idempotent operation — crediting the same commit against the same concept
  twice is a no-op, so the crediting pass can just be re-run freely instead
  of needing its own "have I already processed this" bookkeeping.

## `style_samples` — your verified voice

Verbatim, hand-written code (never AI-authored) kept as a corpus. This is
what `/style` or a future local model would RAG over / fine-tune from to
produce suggestions that sound like you rather than generically idiomatic.
Nothing writes to this table yet — it's schema-ready, feature not built.

## `overrides` — the witness, not the wall

Every row is one instance of: "I asked for full code on a concept I
haven't earned P in, and the tutor gave it to me anyway." The tutor-first
policy never refuses a direct request — but it logs that the request
happened, with a `reason`. This is the audit trail that makes "I chose to
skip learning this" an honest, visible fact instead of a silent bypass.

---

**On `vector` extension**: `CREATE EXTENSION IF NOT EXISTS vector` at the
top requires pgvector installed on the Postgres instance (already true for
the Mac mini instance this project points at). Without it the whole
migration fails at table 6 (`concepts`), not gracefully — there's no
fallback path for embeddings being unavailable.
