# AI Mirror — Rewrite Plan

> The phase-by-phase plan for rewriting this project. Companion to [CONCEPTS.md](CONCEPTS.md)
> (the *why*); this file is the *what and in which order*. Check off phases as they land.

---

## Decisions locked in (2026-07-02)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Classifier placement | **Report-time, batched, cached** | Hook stays pure local I/O (zero write-path friction, no API key needed to capture). LLM runs lazily when the report runs, over a content-hash cache. Honors CONCEPTS §2 (friction kills) and §9 (LLM out of the trust path). |
| Rewrite scope | **v1 mirror + skill ledger ("v1.5")** | The report finally shows the *within vs beyond your skill* split — the vibe-coding fingerprint that is the whole point. Stops before any blocking/tutoring (v2). |
| Storage | **JSONL + JSON files** | Human-readable, git-diffable, zero deps. Schemas kept Postgres-portable for the future Mac mini (local LLM + Pg) — one importer script away. |
| Project structure | **Proper CLI package** | `src/`, one `mirror` binary with subcommands, shared types/config, `bun test`. Ready to grow into v2/v3. |
| Earning P | **Inferred from hand-written code** + manual escape hatch | Committed code with no matching AI event is yours; classify it and credit P automatically. Manual `mirror ledger set` exists but is stored as `claimed` (not `produced`) and flagged ⚠ in reports. |
| Seeding U | **From vault `confidence:` frontmatter** | Vault stays the single source of truth for U; ledger mirrors it on each report run. `/review` already maintains confidence — don't build a second quiz system. |
| Decay | **In this rewrite** | Effective P = stored P decayed by days since `last_produced`. Just date math at report time; without it the ledger lies within months. |
| Old data | **Migrate** | One-time script upgrades existing `events.jsonl` rows to the v2 schema with defaults. History preserved. |
| Style capture | **Yes — new component** | Hand-written (provenance-verified) code also feeds a personal style corpus; a distilled style profile makes AI generation write like *you*. See Phase 4. |

---

## Target architecture

```
  Claude Code edit ──▶ PostToolUse hook (fast, local, no LLM)
                          │  appends raw event: file, lines, code snippet, hash
                          ▼
                   ~/.skillgate/events.jsonl          (append-only provenance log)
                          │
        ┌─────────────────┼──────────────────────────┐
        ▼                 ▼                          ▼
  mirror classify    mirror ledger               mirror style
  (batched LLM,      U ← vault confidence        hand-written corpus
   cache by hash)    P ← hand-written code       → distilled style profile
        │             + decay at read time       → injected into generation
        └────────────────┬───────────────────────────┘
                         ▼
                   mirror report
        within/beyond-skill split · trends · streak
```

Data layout (`~/.skillgate/`, path configurable via `mirror.config.json`):

```
events.jsonl          # append-only provenance log (schema v2)
classify-cache.json   # code_hash → { concepts[], tags[] }   (LLM results, immutable log stays untouched)
skills.json           # the ledger: per concept { U, P, evidence[], last_produced, decay }
style/
  samples.jsonl       # verified hand-written code samples
  profile.json        # distilled per-language style traits
  style-guide.md      # human/CLAUDE.md-readable version of the profile
archive/              # pre-migration backups
```

---

## Phases

### Phase 0 — Skeleton & migration  `[x]`

Restructure into a real package; migrate existing data. Nothing user-visible changes yet.

- `src/` layout:
  ```
  src/
    cli.ts              # entry: mirror <subcommand>
    config.ts           # load/write mirror.config.json, resolve data dir
    types.ts            # Event, LedgerEntry, StyleSample, CacheEntry (single source of truth)
    log.ts              # read/append events.jsonl
    commands/           # one file per subcommand
  tests/
  ```
- **Event schema v2** (versioned, Pg-portable):
  ```jsonc
  { "v": 2, "ts": "...", "author": "ai", "tool": "Edit", "file": "...",
    "project": "...", "lang": "ts", "lines": 12,
    "code_hash": "sha256:...", "snippet": "..." }
  ```
  `concepts` no longer lives in the event — classification results live in `classify-cache.json`
  keyed by `code_hash`, so the log is immutable and re-classification never rewrites history.
- `mirror migrate`: back up old log to `archive/`, upgrade rows to v2 (hash computed from
  stored data where possible, defaults elsewhere).
- `bun test` wired up; CI-less but runnable.

**Done when:** `mirror --help` lists subcommands, old events readable through the new types, tests pass.

---

### Phase 1 — Provenance hook rewrite  `[x]`

The hook becomes what CONCEPTS.md always claimed it was: instant, local, dumb.

- Remove the LLM call and tree-sitter from the hook entirely. It parses stdin, normalizes
  the path, appends one JSONL line. Target: single-digit ms of work.
- Capture `cwd` from the hook input payload (not `process.cwd()`), store normalized project path.
- Snippet stored raw (personal tool — full fidelity beats privacy theater), truncated at a
  sane cap (~8 KB) with `lines` always exact.
- Document known blind spots in code + CONCEPTS.md: Bash heredocs, NotebookEdit, Copilot/paste
  (caught later by v3 git gate, per the doc).
- `mirror setup` updated: idempotent settings.json merge (don't clobber other hooks the user has),
  same interactive data-dir prompt.

**Done when:** an AI edit lands in the log with zero network calls and no API key present.

---

### Phase 2 — Classifier: report-time, tiered, cached  `[x]`

The classifier CONCEPTS §9 describes, actually built.

- **Tier 1 — deterministic:** tree-sitter queries (existing TS/PY query sets, extended) →
  syntax `tags`. Free, instant, always runs.
- **Tier 2 — LLM mapping:** batch all *uncached* events in one or few calls
  (many snippets per request), mapping tags+code → **vault concept titles**.
  Structured output via tool-use JSON schema (typed, no regex-parsing free text).
  Model: `claude-haiku-4-5`, pay-as-you-go key from `.env`.
- **Cache:** `classify-cache.json` keyed by `code_hash`. Unchanged code is never re-sent.
- **Concept identity rule:** `concepts[]` may only contain vault note titles (canonical
  namespace); raw syntax tags stay in `tags[]`. No API key → concepts stay empty, tags still work.
- Runs automatically at the start of `mirror report`, or standalone via `mirror classify`.

**Done when:** running `mirror classify` twice sends zero API calls the second time; events map to real vault titles.

---

### Phase 3 — Skill ledger  `[x]`

The spine (CONCEPTS §5), with the honest-evidence rules decided above.

- `skills.json`, one entry per vault concept:
  ```jsonc
  { "understanding": 2,            // mirrored from vault confidence each run
    "coding_level": 1,             // highest VERIFIED P
    "last_produced": "2026-06-20",
    "decay_days": { "u": 180, "p": 45 },
    "evidence": [ { "type": "produced", "ref": "commit:abc123", "date": "..." },
                  { "type": "claimed",  "ref": "manual",       "date": "..." } ] }
  ```
- **U sync:** each report run reads vault concept notes' `confidence:` frontmatter → U 0–3.
  Vault owns U; the ledger never edits it.
- **P inference pipeline** (heuristic — documented as such):
  1. Walk git commits in the window; collect added lines per file.
  2. Subtract hunks whose content matches logged AI snippets (normalized match).
  3. Surviving hunks = hand-written → run through the Phase 2 classifier →
     `produced` evidence for those concepts, `last_produced` updated.
  4. Same hunks feed the style corpus (Phase 4) — one pipeline, two consumers.
- **Decay at read time:** effective P computed on read from stored P + `last_produced`;
  stored value never destroyed. Levels are per-concept rubrics; v1.5 tracks *level presence*
  (produced this concept at all + recency) — full L1–L4 rubric grading stays v2 (needs challenges).
- `mirror ledger` (view, with effective-vs-stored P), `mirror ledger set <concept> <P>`
  (recorded as `claimed`, always ⚠ in reports).

**Done when:** hand-committing code that uses a concept measurably moves that concept's P and `last_produced`.

---

### Phase 4 — Style corpus & profile  `[x]`  *(new requirement)*

Capture *how you write* from provenance-verified hand-written code, so that when AI
generation is allowed, it produces code indistinguishable from your own hand.

- **Corpus:** the Phase 3 pipeline appends verified hand-written hunks to
  `style/samples.jsonl`: `{ ts, project, file, lang, code, concepts[], commit }`.
  Append-only, full snippets — this is the raw material a future local LLM will fine-tune/RAG over.
- **Distillation:** `mirror style --rebuild` sends the corpus (batched per language) to the LLM
  and produces:
  - `style/profile.json` — structured traits: naming conventions, error-handling idiom,
    comment density/placement, module layout, preferred constructs (e.g. early-return vs nesting,
    FP vs loops), typical function size.
  - `style/style-guide.md` — the same profile as prose + representative examples, written to be
    dropped into a `CLAUDE.md`.
- **Feeding generation (v1.5 mechanism):** documented setup step — reference `style-guide.md`
  from your global `~/.claude/CLAUDE.md` so every Claude Code session writes in your style.
  (Automatic injection via `UserPromptSubmit` hook is the v2 upgrade, noted, not built.)
- **Pg-readiness:** `samples.jsonl` schema is flat and typed; `docs/pg-migration.md` sketches
  the table DDL + one importer script for the Mac mini future. No Pg dependency today.

**Done when:** `mirror style --rebuild` emits a profile that demonstrably reflects your real habits (spot-check against known hand-written files), and a fresh Claude session referencing the guide writes in that style.

---

### Phase 5 — Report v2  `[x]`

The weekly mirror, now with the ledger behind it — the payoff screen.

- Within/beyond-skill split (the ⚠ fingerprint from CONCEPTS §7), driven by **effective (decayed) P**:
  ```
  Concepts the AI handled for you:
     ✓ within your skill:   7
     ⚠ beyond your skill:   5     ← never produced, or P decayed out
     ⚠ claimed-only skill:  2     ← manual attestations backing AI use
  ```
- Trends: week-over-week AI% and beyond-skill count — **the v1 success metric** ("does seeing
  the gap change behavior?"), which decides whether v2 gets built.
- Streak (days shipping only within skill), decay alerts ("python-decorators expires in 6 days"),
  per-project filter, `--week N` back-navigation, `--json` for scripting.
- Line-count honesty: keep `you = git-added − AI` baseline but document its error sources in
  the report footer + CONCEPTS.md (AI rewrites double-count; uncommitted AI edits skew the split).

**Done when:** `mirror` prints the full report against real migrated + new data, and the numbers survive a manual sanity check.

---

### Phase 6 — Docs rewrite  `[x]`

Make CONCEPTS.md true again (its own stated purpose).

- Status markers (✅ built / 🚧 partial / 📋 planned) on every component in §§4–10.
- New **§ Measurement honesty**: line-split error sources, provenance blind spots, P-inference
  heuristic limits.
- New **§ Concept identity**: vault titles = canonical namespace; tags vs concepts.
- New **§ Style profile** section explaining Phase 4's role (capability + voice: the gate ensures
  you *could* write it; the profile ensures what's written *sounds like you*).
- §10 tech table rewritten to reality (Bun, actual deps); v1 sample report replaced with real output.
- README refreshed: install, setup, all subcommands.

**Done when:** someone reading CONCEPTS.md cold cannot find a claim the code contradicts.

---

## Order rationale

0→1 first because everything downstream reads the log — schema must settle before consumers exist.
2 before 3 because P-inference *uses* the classifier. 3 before 4 because the style corpus is fed by
the hand-written-code pipeline. 5 needs everything. 6 last so the doc describes what actually shipped.

## Out of scope (explicitly)

- v2 tutor (prompt-time gating, no-AI challenges, automatic style injection)
- v3 git pre-commit gate
- Postgres / Mac mini deployment (schema-ready only)
- Full L1–L4 rubric grading of P (needs v2 challenges to verify levels)
