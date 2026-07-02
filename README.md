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
Past weeks: 06-20: 0% AI, 0 beyond  ·  06-13: 0% AI, 0 beyond
```

The `⚠ beyond your skill` list is your vibe-coding fingerprint, made visible.

**Read [CONCEPTS.md](CONCEPTS.md) for the why. Read [PLAN.md](PLAN.md) for the build.**

---

## How it works

1. **Capture (instant, local):** a `PostToolUse` hook fires on every Claude Code Edit/Write and appends one line to `events.jsonl` — file, line count, snippet, content hash. No LLM, no network, no API key in the write path. Code you type yourself never fires the hook — that's the provenance signal.
2. **Classify (lazy, cached):** when the report runs, tree-sitter tags each snippet deterministically, then a batched Haiku call maps snippets to concept titles from your Obsidian vault. Results are cached by content hash — unchanged code is never re-sent.
3. **Ledger:** `skills.json` tracks per concept: **U** (understanding, mirrored from your vault's `confidence:` frontmatter) and **P** (coding ability — earned *only* by producing code). Committed code that matches no logged AI snippet is provably yours; `mirror ledger sync` classifies it and credits P automatically. P decays (45-day windows) — use it or lose it.
4. **Style:** the same verified hand-written code feeds a style corpus; `mirror style --rebuild` distills how *you* write into a style guide you can reference from `~/.claude/CLAUDE.md`, so AI-generated code sounds like you.

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

Setup wires the hook into `~/.claude/settings.json`, links the `mirror` command, and offers two opt-ins: installing the companion skills (**/gaps** — triage what the mirror found, **/drill** — 10-minute learn-and-earn, **/mirror-week** — the Friday ritual) and adding the observe-only policy block to your global `~/.claude/CLAUDE.md`.

Then **restart Claude Code** — hooks and skills load on startup.

Upgrading from the v1 log format? Run `mirror migrate` once.

---

## Usage

| Command | What it does |
|---------|--------------|
| `mirror` | weekly report (add a project path to filter, `--week 1` for last week, `--json` for scripts) |
| `mirror classify` | classify uncached events now (otherwise happens at report time) |
| `mirror ledger` | view U / stored P / effective (decayed) P per concept |
| `mirror ledger sync` | scan recent commits for hand-written code → P evidence + style samples |
| `mirror ledger set <concept> <1-4>` | manual claim — recorded as ⚠ claimed, never as verified |
| `mirror style` | style corpus status |
| `mirror style --rebuild` | distill your personal style profile + `style-guide.md` |

Data lives in `~/.skillgate/data` (configurable in `mirror.config.json`) as flat JSONL/JSON — human-readable, git-diffable, and schema-ready for Postgres later (`docs/pg-migration.md`).

---

## Honest limits

- The you/AI line split is an estimate (AI rewrites double-count; uncommitted AI edits skew it). Trend, not truth.
- The hook only sees Claude Code's Edit/Write tools — Copilot, browser paste, and Bash-written code count as "you" until the v3 git gate exists.
- P-inference credits any committed code the Mirror didn't log — including AI code from before the Mirror existed. It gets cleaner the longer it runs.

---

## What's next

- **v2 — The Tutor:** flips Claude into hint mode at prompt time for concepts beyond your P, and adds no-AI challenges that verify P airtight.
- **v3 — The Gate:** a git pre-commit backstop that catches AI code from any source. Advisory first, fails open.

Build the mirror first; earn the right to build the wall.
