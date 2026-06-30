# AI Mirror

The Mirror is a passive recorder. It watches every code change you make in Claude Code, tags each one "you wrote this" vs "the AI wrote this", labels which concepts were involved, and once a week shows you a report of how much you're actually leaning on AI — and for which concepts. It blocks nothing. It just holds up a mirror.

```
AI Mirror — week of 2026-06-23 → 2026-06-29
──────────────────────────────────────────────────
Code shipped:        420 lines
  you: 95  ·  AI: 325  →  77% AI-written

Concepts the AI handled for you:
   · python-decorator-factory       4×
   · asyncio-gather                 2×
   · sqlalchemy-relationship        6×

Files AI touched (3):
   4×  /your/project/auth.py
   6×  /your/project/models.py
   2×  /your/project/tasks.py
```

---

## How it works

- A `PostToolUse` hook fires every time Claude Code writes or edits a file
- The hook logs the event to `data/events.jsonl` — file path, line count, timestamp, and which concepts the code uses (detected via tree-sitter + your Obsidian vault)
- `bun run report` reads the log and your git history to produce the weekly breakdown

Code you type yourself is never hooked — only Claude's tool calls are. That's the provenance signal.

---

## Installation

### Requirements

- [Bun](https://bun.sh) — `curl -fsSL https://bun.sh/install | bash`
- [Claude Code](https://claude.ai/code) — the CLI or VS Code extension
- An Anthropic API key (for vault-grounded concept detection — optional, falls back to syntax tags without it)

### Steps

**1. Clone into `~/.skillgate`**

```bash
git clone https://github.com/MunyinSam/ai-mirror ~/.skillgate
```

> You can clone anywhere, but `~/.skillgate` keeps it out of your projects and makes the hook path consistent across machines.

**2. Install dependencies**

```bash
cd ~/.skillgate
bun install
```

**3. Run setup**

```bash
bun run setup
```

This wires the `PostToolUse` hook into `~/.claude/settings.json` and creates the `data/` directory. It's safe to run more than once.

**4. Add your API key** *(optional — enables vault-grounded concept detection)*

```bash
echo "ANTHROPIC_API_KEY=your-key-here" > ~/.skillgate/.env
```

**5. Restart Claude Code**

The hook only loads on startup. Restart the CLI or reload the VS Code window.

---

## Usage

**Weekly report** — run from anywhere:

```bash
bun run ~/.skillgate/report.ts
```

Or filter to a specific project:

```bash
bun run ~/.skillgate/report.ts /path/to/your/project
```

**Add a convenience alias** to your shell:

```bash
# ~/.bashrc or ~/.zshrc
alias mirror="bun run ~/.skillgate/report.ts"
```

Then just run `mirror` from anywhere.

---

## Vault-grounded concept detection

If you use an [Obsidian](https://obsidian.md) vault with `~/.claude/vault-config.json` pointing at it, the Mirror reads your concept notes and asks Claude Haiku to map detected syntax patterns to concepts you've actually filed. This means the report shows concept names from *your* knowledge map, not generic tags.

Without a vault or API key, concept detection falls back to structural syntax tags (`async_await`, `try_catch`, `decorator`, etc.) — still useful, just not personalised.

---

## What's next

This is v1 — the Mirror. It observes, never blocks.

- **v2 — The Tutor:** intercepts prompts at generation time and flips Claude into hint mode for concepts beyond your skill level
- **v3 — The Gate:** a git pre-commit hook that catches AI-written code from any source (including Copilot, browser paste) before it enters your history
