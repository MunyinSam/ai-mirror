# AI Mirror

AI Mirror watches the code you write with AI, tells you honestly how much of it you couldn't have written yourself, and — over time — stops you from shipping code beyond your real skill, without ever banning AI.

It blocks nothing (yet). It just holds up a mirror:

```
AI Mirror — week of 2026-06-27 → 2026-07-04  [all projects]
────────────────────────────────────────────────────────
Code shipped:        2149 lines
  you: 1714  ·  AI: 435  →  20% AI-written

Concepts the AI handled for you:
   ✓ within your skill:   7
   ⚠ beyond your skill:   3
        · Claude Code Hooks                used 2×
        · Tree-sitter                      used 1×
        · Python async/await and the Event Loop used 1×

Days shipping only within your skill: 1 🔥

Past weeks:
   wk 06-20  ████████████████  0% AI-written, 0 beyond
   wk 06-13  ████████████████  0% AI-written, 0 beyond
```

The `⚠ beyond your skill` list is your vibe-coding fingerprint, made visible.

**Read [CONCEPTS.md](CONCEPTS.md) for the why. Read [PLAN.md](PLAN.md) for the build. Read [docs/how-it-works.md](docs/how-it-works.md) for the architecture (with diagrams) and [docs/commands.md](docs/commands.md) for every command in detail.**

---

## How it works

1. **Capture (instant, local):** a `PostToolUse` hook fires on every Claude Code Edit/Write and appends one line to `events.jsonl` — file, line count, snippet, content hash. No LLM, no network, no API key in the write path. Code you type yourself never fires the hook — that's the provenance signal.
2. **Classify (lazy, cached):** when the report runs, tree-sitter tags each snippet deterministically, then a batched Haiku call maps snippets to concept titles from your Obsidian vault. Results are cached by content hash — unchanged code is never re-sent.
3. **Ledger:** `skills.json` tracks per concept: **U** (understanding, mirrored from your vault's `confidence:` frontmatter) and **P** (coding ability — earned *only* by producing code). Committed code that matches no logged AI snippet is provably yours; `mirror ledger sync` classifies it and credits P automatically. P decays (45-day windows) — use it or lose it.
4. **Style:** the same verified hand-written code feeds a style corpus; `mirror style --rebuild` distills how *you* write into a style guide plus a compact digest, so AI-generated code sounds like you.
5. **Tutor (prompt time, v2):** a `UserPromptSubmit` hook matches each code prompt against the ledger — locally, instantly — and injects tutor-mode instructions for unearned concepts plus your style digest. Explicit requests always get full code; the override is logged, and `mirror challenge` is the verified way back up.

---

## Installation

### Requirements

- [Bun](https://bun.sh)
- [Claude Code](https://claude.ai/code) — CLI or VS Code extension
- An Anthropic API key (optional — enables vault concept mapping and style distillation; capture works without it)

### Steps

```bash
git clone https://github.com/MunyinSam/ai-mirror
cd ai-mirror
bun install
bun run setup
echo "ANTHROPIC_API_KEY=sk-..." > .env   # optional
```

Setup wires the hook into `~/.claude/settings.json`, links the `mirror` command, and offers opt-ins along the way: an API key for concept mapping, a minimal vault scaffold (defaulting to your most recent Obsidian vault when one is detectable), the companion skills (**/gaps** — triage what the mirror found, **/drill** — 10-minute learn-and-earn, **/mirror-week** — the Friday ritual), the commit-time gate advisory for a repo of your choice, and the observe-only policy block in your global `~/.claude/CLAUDE.md`.

Then **restart Claude Code** — hooks and skills load on startup.

---

## Usage

| Command | What it does |
|---------|--------------|
| `mirror` | the report — `--day` / `--week` / `--month` / `--year` views, `--back N` to go back, a project path to filter, `--files` for per-file detail, `--json` for scripts. Auto-credits recent hand-written commits (last 30 days) on every run. |
| `mirror ledger` | view U / stored P / effective (decayed) P per concept |
| `mirror ledger sync` | scan recent commits for hand-written code → P evidence + style samples |
| `mirror style` | style corpus status |
| `mirror style --rebuild` | distill your personal style profile + `style-guide.md` + prompt digest |
| `mirror challenge <concept>` | generate a no-AI challenge sandbox; hand-type the solution to earn verified P (the only path to L2–L4) |
| `mirror challenge grade` | provenance-check the sandbox (AI edits void it), then LLM-grade against the rubric |
| `mirror override <concept>` | log that you shipped code beyond your P — witnessed, never blocked |
| `mirror gate install [repo]` | wire the v3 pre-commit advisory into a repo (chains any existing hook; `uninstall` restores it) |
| `mirror gate check` | what the hook runs: classify the staged diff, name beyond-skill concepts, always exit 0 |

Data lives in `~/.skillgate/data` (configurable in `mirror.config.json`) as flat JSONL/JSON — human-readable, git-diffable, and schema-ready for Postgres later (`docs/pg-migration.md`).

---

## How lines are counted

The report's you/AI split comes from two independent counters:

**AI lines — counted directly, at write time.** The `PostToolUse` hook counts the lines of every Edit/Write the agent makes (`content` for Write, `new_string` for Edit) and logs them to `events.jsonl`. No filtering — blank lines, comments, and non-code files all count. The report sums these per period.

**Your lines — inferred, at report time.** Git doesn't record who typed what, so your lines are a subtraction, not a measurement:

```
you-lines = max(0, git lines added across all known repos − AI lines)
```

where "git lines added" is the added-column total of `git log --numstat` over the period.

**P evidence uses a stricter test.** For crediting skill, `mirror ledger sync` doesn't trust the subtraction. It parses each commit's added hunks and checks them against the logged AI snippets line-by-line: a hunk counts as yours only if it's in a code language, at least 3 lines, and **fewer than half** of its significant lines (trimmed, ≥ 8 chars — braces and blanks carry no authorship signal) appear in the AI snippet log. Surviving hunks become P evidence and style-corpus samples.

Consequence of the subtraction: when the AI writes 50 lines and then rewrites them, that's 100 AI lines against ~50 committed — the split can undercount you within a period. That's why the report footer says *trend, not truth*.

---

## Honest limits

- The you/AI line split is an estimate (AI rewrites double-count; uncommitted AI edits skew it). Trend, not truth.
- The hook only sees Claude Code's Edit/Write tools — Copilot, browser paste, and Bash-written code count as "you" in the line split. The v3 gate closes the *concept* half of this hole at commit time (it classifies staged code regardless of author), but line-level provenance for those sources is gone by then.
- Your own commits never create log events (no hook fires — that's the provenance signal). They're counted from git history at report time and credited as P by the auto-sync. Repos the AI has never touched are invisible to the baseline unless you add them to `projects` in `mirror.config.json`.
- P-inference credits any committed code the Mirror didn't log — including AI code from before the Mirror existed. It gets cleaner the longer it runs.

---

## The tutor (v2) — built

A `UserPromptSubmit` hook (wired by setup) checks every code-intent prompt against the ledger — locally, no API call. Mention a concept whose P is unearned, decayed, or claimed-only, and the session defaults to **tutor mode**: hints, pseudocode, a failing test. Ask explicitly for the full code and you get it — plus a logged override the weekly report counts. The same hook injects your style digest so generated code reads like yours.

## The gate (v3) — built, advisory-only

A git pre-commit backstop — the universal net that catches code from **any** source (Copilot, browser paste), because everything funnels through `git commit`. Run `mirror gate install` in a repo and every commit gets a short advisory:

```
── AI Mirror gate · advisory, never blocks · ~35% matches the AI log ──
  ⚠ beyond your skill: Tree-sitter, Claude Code Hooks
  · unfiled concepts: Worker Pool Pattern
  committing anyway is fine — /drill <concept> is 10 minutes
```

Staged code hunks are classified (cache first; uncached ones get one LLM call with a 5-second timeout) and judged against your effective P. It **always exits 0** and fails open — no key, a timeout, or any error means silence, never a blocked commit. A pre-existing pre-commit hook is chained first and keeps its own blocking power. Every advisory lands in `gate.jsonl` — the data that will decide whether a blocking mode is ever justified.

Build the mirror first; earn the right to build the wall.
