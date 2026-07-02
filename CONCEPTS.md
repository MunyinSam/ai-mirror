# AI Mirror — Concepts

> A document explaining every concept behind this project, written to be read cold.
> If you forget *why* a decision was made, it's in here.
>
> Component status is marked throughout: ✅ built · 🚧 partial · 📋 planned.
> The build order and decisions live in [PLAN.md](PLAN.md).

---

## 0. The one-sentence version

**AI Mirror watches the code you write with AI, tells you honestly how much of it you couldn't have written yourself, and — over time — stops you from shipping code beyond your real skill, without ever banning AI.**

It is the first stage ("the Mirror") of a larger system whose job is to **stop "vibe coding"** — leaning on AI to produce code you don't understand and couldn't reproduce.

---

## 1. The problem

You use AI to write code. That's fine — and unavoidable. The danger is the **silent gap** between:

- what the **AI can produce** (basically anything), and
- what **you can produce unaided** (your actual skill).

Every time you accept AI code you couldn't have written, that gap widens *invisibly*. You feel productive, but your skill isn't growing — it may be shrinking. That's **vibe coding**, and it's the thing this project exists to fight.

### Why your current setup isn't enough

You already have learning tools (an Obsidian vault, Socratic learning skills, concept-filing workflows). They **reduce** vibe coding but don't **enforce** anything. They are a **voluntary front door**:

> If you walk through the door, you learn. But nothing stops you from walking *around* it — pasting from a chat window, accepting a completion, shipping code you don't understand.

The whole insight of this project: **to enforce, you have to move from a door you choose to open, to a checkpoint that fires whether you like it or not.**

---

## 2. The core mental model: a commitment device (not DRM)

You are enforcing rules **on yourself**. That changes everything.

This is **not** security. There's no attacker to defeat. You're not trying to stop a hacker — you're trying to stop *yourself* at the moment your willpower is lowest (deadline, 11pm, the AI already wrote the answer).

The right analogy is a **commitment device** — like:
- **Cold Turkey** / **Freedom** (website blockers you install on yourself)
- **StickK** (you bet money you'll keep a habit)

Key properties of a commitment device:
- You can **always override it** (the key is in your own pocket).
- It works anyway, because it **raises the activation energy** of the bad choice and makes the bad choice **visible and counted**.

So the design goal is **not** an unbreakable wall. It's:
1. Make the **default, frictionless path** the one that builds skill.
2. Make vibe coding require a **deliberate, logged override**.

A pure "blocker" that you rage-quit in a week is worse than a gentle mirror you actually keep. **Friction is the #1 thing that kills these tools.** Every design decision bows to that.

---

## 3. The most important conceptual distinctions

These four ideas are the intellectual core. If you understand only this section, you understand the project.

### 3.1 Understanding (U) ≠ Coding ability (P)

This is the correction that makes the whole thing real.

- **Understanding (U):** can you *explain* a concept? The mental model, the "why." This is what reading a note, watching a video, or passing a quiz proves. It's **recall**.
- **Coding ability (P):** can you *write* it from scratch, unaided? This is **production**.

**You can have U without P.** You can perfectly explain a Python decorator factory and still freeze when asked to write one cold. Reading about something ≠ being able to build it.

A naive version of this tool would track one "do you know it" number. That number would be a lie — it would pass you on things you *understand* but can't *produce*, which is exactly the gap that lets you vibe-code through your own system.

**So the tool tracks U and P separately, and the enforcement only ever looks at P.**
- U is a *prerequisite* — you generally need to understand something before you can produce it.
- But **U never opens the gate by itself**. Only producing the code does.

### 3.2 Levels of P, not a yes/no

"Can you write decorators" is too coarse. There's a ladder. For decorators it might be:

| Level | Means |
|-------|-------|
| L1 | Apply an existing decorator (`@app.route(...)`) |
| L2 | Write a basic decorator (wraps a function, handles `*args/**kwargs`) |
| L3 | Write a *decorator factory* (a decorator that takes arguments) |
| L4 | Write a stateful / class-based decorator, preserve metadata |

The gate then asks a precise question: *this code uses decorators at **L3** — is your verified P for decorators ≥ L3?* If you're only L1 (you've used them, never written one), it knows.

### 3.3 Capability, not authorship

A subtle but crucial point that resolves the "isn't this useless?" objection.

The gate checks whether **you are *capable* of producing this code** — not whether you literally typed every character.

Why this is correct:
- Once you've *proven* you can write decorator factories, letting AI write them for you is **legitimate acceleration** — you can read, debug, and own that code. That's how a senior engineer uses AI.
- The gate enforces: **"earn the skill once, then you may delegate it."**

And **decay** (see §3.4) handles the staleness: if you stop writing decorators yourself and let AI do all of it, your P for decorators decays, and eventually the gate re-challenges you. **Use it or lose it.**

So the rule is: *AI may write code at a level you've earned; AI may not write code at a level you haven't.* That's the whole philosophy in one line — and it's exactly "you can still ask AI, but not for answers beyond your skill."

### 3.4 Provenance is a write-time signal

**This is the deepest technical insight, and it shapes the entire architecture.**

To know whether *you* or *the AI* wrote a piece of code, you must capture that fact **at the moment the code enters the file**. It's a **write-time** truth.

By the time code reaches a git commit, **the authorship signal is gone** — a diff is just text. Looking at a finished decorator factory in a commit, *nothing in it tells you whether you typed it or pasted it.* You cannot reliably recover authorship after the fact; trying to guess it from the text is the false-positive that makes the whole ledger lie.

**Consequence:** the only trustworthy place to capture "AI vs you" is the editor / agent layer, **as the code is written.** In our case, that's **Claude Code's hooks** (see §6). This single fact is *why* the Mirror is built where it's built, and why the git-commit gate alone can never be the foundation.

---

## 4. The architecture (the whole system)

Everything orbits one **spine** plus a set of **gates**, fed by an **earn loop**, watched by an **accountability layer**.

```
                  ┌──────────────────────────────────────┐
                  │   SKILL LEDGER  (the spine)          │
                  │   per concept:                        │
                  │     understanding U (0-3)             │
                  │     coding ability P (level, decays)  │
                  │   built from: your vault + your work  │
                  └───────────────┬──────────────────────┘
                                  │  "what can you actually produce?"
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                          ▼
   PROVENANCE              GATES (choke points)        ACCOUNTABILITY
   (write-time:            v1 mirror: observe          weekly report,
    you vs AI)             v2 tutor:  prevent          override log,
                           v3 gate:   block            "concepts you dodge",
                                  │                     decay alerts
                                  ▼
                          EARN LOOP (when blocked)
                          learn (raises U) → produce
                          the code (raises P) → opens
```

- **Skill Ledger** — the source of truth for what you can produce. (§5)
- **Gates** — the checkpoints where code enters your project. Three stages. (§7)
- **Earn loop** — the way *out* of a block: learn it, then write it. The block always has a fast exit.
- **Accountability** — turns invisible drift into visible, countable facts. (§8)

---

## 5. The Skill Ledger  ✅ built

A local file (`skills.json`). One entry per concept:

```jsonc
{
  "Python Decorators": {
    "understanding": 2,          // U: mirrored from the vault's confidence frontmatter
    "coding_level": 1,           // P: highest level you've PRODUCED unaided & verified
    "last_produced": "2026-06-20",
    "decay_days": { "u": 180, "p": 45 },   // P decays faster
    "evidence": [
      { "type": "produced", "ref": "commit:abc1234", "date": "2026-06-20" },
      { "type": "claimed",  "ref": "manual",         "date": "2026-06-01" }
    ]
  }
}
```

Key rules:
- **Effective P = stored P decayed by time since you last produced it** (one level per full decay window, computed at read time — stored values are never destroyed). Knowing ≠ remembering; the ledger must not lie to you six months later.
- **The gate reads P.** U is supporting context.
- **You can't *file* your way to a higher P — you have to *produce* your way there.** This is what stops you from stubbing a fake note to unlock the gate. It's stronger than a quiz: the unlock *is* writing the code.
- **Evidence types are honest.** `produced` = provenance-verified hand-written code. `claimed` = a manual `mirror ledger set` attestation — allowed as an escape hatch, but always shown with a ⚠ and never counted as verified.

The ledger is **seeded** from two sources:
1. **Your Obsidian vault** → each concept note's `confidence:` (learning/solid/fluent) maps to U 1–3. The vault owns U; the ledger only mirrors it.
2. **Your actual work** → committed code with no matching AI event is provably yours; it's classified and credited as `produced` evidence automatically (`mirror ledger sync`). This is a heuristic — the airtight version is v2's no-AI challenges.

📋 *Deferred to v2:* per-concept L1–L4 rubric grading. Today the ledger tracks level *presence* (you produced this concept, and how recently); grading which rung you hit needs the challenge system.

---

## 6. Provenance via Claude Code hooks  ✅ built

**Hooks** are commands Claude Code runs automatically when certain things happen. They are configured in `settings.json` and fire regardless of whether you use the terminal or the VS Code extension — because they fire on the **agent's tool calls**, not on the UI.

The ones that matter:
- **`PostToolUse`** — fires *after* the AI does an Edit or Write. → "the AI just wrote this." (The Mirror's engine.)
- **`PreToolUse`** — fires *before* an Edit/Write; can block it. (Used later by the gate.)
- **`UserPromptSubmit`** — fires when you send a prompt; can modify it. (Used later by the tutor.)

The provenance trick:
- **AI writes code** → goes through an Edit/Write tool → `PostToolUse` fires → logged as **AI-authored**.
- **You hand-type code** → never goes through a tool call → no hook fires → implicitly **yours**.

This is the write-time capture from §3.4, and it's the only trustworthy source of "who wrote this."

> **Blind spot to know:** Claude Code's hook only sees *Claude Code's* edits. Other AI in your editor (Copilot completions, pasting from a browser chat) does **not** fire the hook, so the Mirror counts it as "you." This is acceptable because your AI coding happens mostly in Claude Code — and the later git gate (v3) is the universal net that catches everything at commit time.

---

## 7. The gates — three stages, in order

The system is **staged**. You build the cheapest, most informative thing first and earn the right to build the stricter things.

### v1 — THE MIRROR  ✅ built (this folder)
A **passive observer**. It blocks nothing.

The `PostToolUse` hook logs every AI edit **instantly and locally** — file, lines, a snippet, a content hash. Nothing else happens at write time. Classification, ledger math, and the report all run lazily when you ask for them.

What a week looks like (real output shape):

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

That `⚠ beyond your skill` list is your vibe-coding fingerprint, made visible.

**Why the Mirror is v1:**
1. **Cheap** — a weekend. A hook script + a log file + a report command. No blocking to tune, no friction to fight, no API token needed.
2. **It tests the core hypothesis before you sink ~35 hours into a wall:** *does merely seeing the gap change my behavior?* If yes, you may never need the gate. If no, you've *proven* you need stricter enforcement — decided with data, not a guess.
3. **It's the foundation, not a throwaway.** The write-time "AI vs you" tag is the exact provenance layer that v2 and v3 require. You'd have to build it first anyway.

**What it deliberately does NOT do:** block commits, stop the AI, judge you in the moment, or withhold answers. Just honest measurement at near-zero friction.

### v2 — THE TUTOR  📋 planned (prevention)
Moves the intervention *upstream* to generation time. Using `UserPromptSubmit` / `PreToolUse`, when you ask for code involving a concept **beyond your P**, the hook flips the AI into **tutor mode** — hints, pseudocode, a failing test — but **not** the finished answer. You never receive code you can't own in the first place.

Built **only if** the Mirror shows you actually drifting. P is raised through an **explicit no-AI challenge** (write it in a sandbox, graded) — authorship certain by construction.

> The "withhold answers, give hints" behavior itself is already commoditized (Claude's Learning Mode, OpenAI's Study Mode). Don't rebuild the tutor — *route to it*. Your originality is the **ledger + the gating**, not the tutoring.

### v3 — THE GATE  📋 planned (backstop)
A git **pre-commit** hook — the universal net. It catches code from **any** source (including the Copilot/paste blind spot the Mirror can't see), because everything funnels through `git commit`. Ships **advisory-first** (it *tells* you) before it ever **blocks**, and **fails open** if unsure — so a misfiring classifier never feels arbitrary.

**Principle: build the mirror first; earn the right to build the wall.**

---

## 8. The accountability layer

Enforcement you can defeat (you can always `git commit --no-verify` or hand-edit the ledger) only works if the **honest path stays easier than the cheat path**, and if cheating is **visible**.

- **Override is logged, not blocked.** You *can* ship un-owned code; it just gets written to an override log.
- **Weekly report** surfaces the pattern ("you overrode React hooks 7× — go learn it").
- **One public number** you show a friend or post — recruits identity and a little healthy shame, which beat raw friction.

This is the "StickK" part: the consequence isn't a wall, it's **a witness**.

---

## 9. The classifier (how concepts get detected)  ✅ built

To say "this code uses decorators," something must read the code. This is the hardest technical piece, and it's handled in **tiers** to stay fast, cheap, and trustworthy:

1. **Cheap deterministic detectors first** — parse the code with **tree-sitter** and match syntax patterns (decorators, async/await, comprehensions, generics…). Instant, free, deterministic. These become `tags`.
2. **LLM for vault mapping, batched** — one call per ~15 snippets maps code + tags to **vault concept titles**, with structured output via a forced tool call (typed JSON, never parsed free text). Model: Haiku, pay-as-you-go — cents per month.
3. **Cache by content hash** (`classify-cache.json`) — unchanged code is never re-sent. Entries classified before an API key existed are marked and backfilled once a key appears.

Two design rules, both load-bearing:
- **Keep the LLM out of the trust path where you can.** A non-deterministic classifier that misfires and blocks you on something you *do* know will destroy your trust in the tool — and a tool you don't trust gets disabled.
- **Keep the LLM out of the *hot* path entirely.** The classifier never runs in the hook. It runs when the report runs. Write-time stays local-only, key-optional, single-digit-milliseconds.

---

## 10. Tech stack & shape  ✅ built

- **Language: TypeScript on Bun.** Native to the Claude Code ecosystem. Tree-sitter parses **both** Python and JS/TS (the TypeScript grammar handles plain JS), so concept-detection covers a full-stack codebase with one parser.
- **Shape: a local-first toolkit — one hook script + a `mirror` CLI over a data folder** (`~/.skillgate/data` by default, configurable in `mirror.config.json`). No GUI, no server, no frontend. Closer to a `git` plugin than an app.
- **No API token needed for capture.** The hook is pure local file I/O. A token is needed only at *report time* for vault-concept mapping and style distillation — a separate Anthropic API key (not your Claude Code subscription), billed pay-as-you-go, **cents per month**.
- **Storage is flat JSONL/JSON** — human-readable, git-diffable, hand-repairable, and schema-portable to Postgres for the future local setup (see `docs/pg-migration.md`).

| Need | How |
|------|-----|
| provenance log | `events.jsonl` (append-only, schema v2) |
| classification cache | `classify-cache.json` keyed by content hash |
| skill ledger | `skills.json` |
| style corpus + profile | `style/samples.jsonl`, `style/profile.json`, `style/style-guide.md` |
| concept AST | `web-tree-sitter` + `tree-sitter-typescript` / `tree-sitter-python` |
| structured LLM output | `@anthropic-ai/sdk` forced tool calls (typed JSON) |
| git interrogation | `node:child_process` → `git log -p -U0` |
| CLI | hand-rolled dispatch in `src/cli.ts` (no framework needed) |
| tests | `bun test` (`tests/`) |

---

## 11. Measurement honesty  ✅ documented limits

A tool about honest measurement must document its own error sources. These are known, accepted, and printed in the report footer:

- **`you-lines = git lines added − AI lines` is an estimate.** AI rewrites of the same code double-count; AI edits not yet committed inflate AI% against the git baseline. Treat the ratio as a *trend*, not truth.
- **Provenance blind spots:** code the agent writes via Bash heredocs or NotebookEdit, Copilot completions, and browser-chat pastes never fire the hook and count as "you." Acceptable for now; the v3 git gate is the universal net.
- **P-inference is a heuristic.** "Committed code that matches no logged AI snippet" is only as good as hook coverage — code AI wrote *before* the Mirror existed (or outside it) can be miscredited as hand-written. The corpus and ledger get cleaner the longer the Mirror runs. The airtight version is v2's sandboxed challenges.
- **Snippet matching is line-based.** Trivial lines (braces, blanks, short returns) are excluded from authorship matching; a hunk is AI-matched at ≥50% significant-line overlap.

## 12. Concept identity  ✅ built

One namespace rule keeps the whole system coherent: **`concepts` may only contain vault note titles, exactly as written in the note's `title:` frontmatter.** Raw tree-sitter output lives separately as `tags`. The LLM mapper is constrained to the vault list and anything outside it is discarded. No vault → no concepts (tags still work) — the system never invents a concept you haven't filed.

## 13. The style profile  ✅ built

The gate family answers *"could you have written this?"* The style profile answers a second question: *"does what the AI writes sound like you?"*

Every provenance-verified hand-written hunk feeds `style/samples.jsonl` — an append-only corpus of how you actually code. `mirror style --rebuild` distills it (per language) into structured traits — naming, function shape, error handling, comment habits, idioms, notable absences — plus a human-readable `style-guide.md`. Reference that guide from your global `~/.claude/CLAUDE.md` and every Claude Code session writes code in *your* voice, not the model's default.

Why it belongs here: once the gate says AI may write something (you've earned it), the output should still be code you'd naturally own. Capability gating plus style matching is what makes delegation indistinguishable from your own work — legitimately.

📋 *Planned:* automatic injection via `UserPromptSubmit` (v2), and RAG/fine-tuning over the corpus on the local-LLM setup (see `docs/pg-migration.md`).

## 14. Success metric

Without a metric you can't tell if it's working:

1. **v1 (the Mirror): week-over-week trend of AI% and beyond-skill concept count.** This is the number that answers "does merely *seeing* the gap change my behavior?" — and decides, with data, whether v2 gets built. The report prints it every week.
2. **v2/v3: overrides trending toward zero** over time.
3. **The end test: rebuild a past vibe-coded project unaided** (the Discord bot). That's a pure test of P — the real-world pass/fail.

---

## 15. Glossary

| Term | Meaning |
|------|---------|
| **Vibe coding** | Shipping AI-generated code you don't understand and couldn't reproduce. The thing this fights. |
| **Commitment device** | A self-imposed constraint (Cold Turkey / StickK). The mental model — not DRM. |
| **U (understanding)** | Can you *explain* it. From vault notes / quizzes. Decays slowly. |
| **P (coding ability)** | Can you *write* it unaided, at a level. From producing code. Decays fast. The gate reads this. |
| **Provenance** | Who wrote a piece of code (you vs AI). A **write-time** signal, lost by commit time. |
| **Hook** | A command Claude Code runs automatically on an event (`PostToolUse`, etc.). |
| **The Mirror (v1)** | Passive provenance log + weekly report. Observes, never blocks. |
| **The Tutor (v2)** | Generation-time prevention — flips AI to hints for beyond-P concepts. |
| **The Gate (v3)** | A git pre-commit backstop that catches everything at commit time. |
| **Earn loop** | The way out of a block: learn it (U), then produce it (P). |
| **Classifier** | Maps code → which concepts/levels it uses. Tiered: deterministic first, LLM for the rest. |
| **Skill Ledger** | The local file storing U and P per concept. The spine. |
| **Produced / claimed** | Evidence types. Produced = provenance-verified hand-written code. Claimed = manual attestation, always flagged ⚠. |
| **Style profile** | Traits distilled from your verified hand-written code so allowed AI generation writes in your voice. |

---

*This document is the conceptual reference for AI Mirror. The implementation is v1.5: a `PostToolUse` hook logging provenance events (`src/hook.ts`), a tiered cached classifier, the skill ledger, the style corpus, and the `mirror` CLI (`src/cli.ts` — report / classify / ledger / style / setup / migrate). See [PLAN.md](PLAN.md) for the build history and what comes next.*
