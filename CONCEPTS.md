# AI Mirror — Concepts

> A document explaining every concept behind this project, written to be read cold.
> If you forget *why* a decision was made, it's in here.

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

## 5. The Skill Ledger

A local file (`skills.json` or a small database). One entry per concept:

```jsonc
{
  "python-decorators": {
    "understanding": 3,        // U: can explain it
    "coding_level": 1,         // P: highest level you've PRODUCED unaided & verified
    "rubric": {                // the per-concept ladder
      "1": "apply an existing decorator",
      "2": "write a basic decorator",
      "3": "write a decorator factory",
      "4": "stateful/class decorator + metadata"
    },
    "evidence": ["challenge:dec-factory-2026-07-02"],
    "last_used": "2026-06-20",
    "decay": { "understanding": 180, "coding": 45 }  // P decays faster (days)
  }
}
```

Key rules:
- **Effective P = stored P decayed by time since you last produced it.** Knowing ≠ remembering; the ledger must not lie to you six months later.
- **The gate reads P.** U is supporting context.
- **You can't *file* your way to a higher P — you have to *produce* your way there.** This is what stops you from stubbing a fake note to unlock the gate. It's stronger than a quiz: the unlock *is* writing the code.

The ledger is **seeded** from two sources:
1. **Your Obsidian vault** → each concept note becomes a candidate at U = filed.
2. **Your actual work + challenges** → produces P evidence.

---

## 6. Provenance via Claude Code hooks

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

### v1 — THE MIRROR (this folder)
A **passive observer**. It blocks nothing.

It uses the `PostToolUse` hook to log, for every edit: *who wrote it (you/AI)*, *which concepts it used*, *when*. Then a CLI command prints a weekly report.

What a week looks like:

```
AI Mirror — week of 2026-06-23 → 06-29
──────────────────────────────────────
Code shipped:        420 lines   (you: 95 · AI: 325  → 77% AI-written)
Concepts the AI handled for you:
   ✓ within your skill:  7   (you could have written these — fine)
   ⚠ beyond your skill:  5   (AI wrote, you've never produced unaided)
        · python-decorator-factory   used 4×
        · asyncio-gather             used 2×
        · sqlalchemy-relationship    used 6×
Days shipping only within your skill:  2 🔥
```

That `⚠ beyond your skill` list is your vibe-coding fingerprint, made visible.

**Why the Mirror is v1:**
1. **Cheap** — a weekend. A hook script + a log file + a report command. No blocking to tune, no friction to fight, no API token needed.
2. **It tests the core hypothesis before you sink ~35 hours into a wall:** *does merely seeing the gap change my behavior?* If yes, you may never need the gate. If no, you've *proven* you need stricter enforcement — decided with data, not a guess.
3. **It's the foundation, not a throwaway.** The write-time "AI vs you" tag is the exact provenance layer that v2 and v3 require. You'd have to build it first anyway.

**What it deliberately does NOT do:** block commits, stop the AI, judge you in the moment, or withhold answers. Just honest measurement at near-zero friction.

### v2 — THE TUTOR (prevention)
Moves the intervention *upstream* to generation time. Using `UserPromptSubmit` / `PreToolUse`, when you ask for code involving a concept **beyond your P**, the hook flips the AI into **tutor mode** — hints, pseudocode, a failing test — but **not** the finished answer. You never receive code you can't own in the first place.

Built **only if** the Mirror shows you actually drifting. P is raised through an **explicit no-AI challenge** (write it in a sandbox, graded) — authorship certain by construction.

> The "withhold answers, give hints" behavior itself is already commoditized (Claude's Learning Mode, OpenAI's Study Mode). Don't rebuild the tutor — *route to it*. Your originality is the **ledger + the gating**, not the tutoring.

### v3 — THE GATE (backstop)
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

## 9. The classifier (how concepts get detected)

To say "this code uses decorators at L3," something must read the code. This is the hardest technical piece, and it's handled in **tiers** to stay fast, cheap, and trustworthy:

1. **Cheap deterministic detectors first** — parse the code with **tree-sitter** and match patterns (a decorator that is itself a call returning a wrapper = a factory). Instant, free, deterministic. Handles most cases.
2. **LLM only on the fuzzy residual** — the ambiguous level calls and brand-new concepts. Uses the Anthropic SDK with **structured output (a Zod schema)** so it returns reliable `{concept, level}` data, not free text.
3. **Cache by content hash**; skip unchanged files.

Design rule: **keep the LLM out of the trust path where you can.** A non-deterministic classifier that misfires and blocks you on something you *do* know will destroy your trust in the tool — and a tool you don't trust gets disabled.

---

## 10. Tech stack & shape

- **Language: TypeScript / Node.** Native to the Claude Code ecosystem (CC, the agent SDK, and plugins are all TS). Tree-sitter in Node parses **both** Python and JS/TS, so concept-detection covers a full-stack codebase with one parser.
- **Shape: a local-first toolkit — hook scripts + a CLI over a local `.skillgate/` folder.** No GUI, no server, no frontend. Closer to a `git` plugin than an app.
- **No API token needed for v1** (the Mirror is pure local file I/O). A token is needed only for the LLM classifier, and only for its fuzzy cases — a separate Anthropic API key (not your Claude Code subscription), billed pay-as-you-go. Using a cheap model for classification costs **cents per month**.

| Need | Library |
|------|---------|
| filesystem walk | `fast-glob` |
| frontmatter parsing | `gray-matter` |
| run git / shell | `node:child_process` / `execa` |
| structured LLM output | `@anthropic-ai/sdk` + Zod |
| concept AST | `web-tree-sitter` |
| git hooks | `husky` |
| datastore | `events.jsonl` / `better-sqlite3` |
| CLI | `commander` |

---

## 11. Success metric

Without a metric you can't tell if it's working. The two clean ones:

1. **Overrides trending toward zero** over time.
2. **Can you finally rebuild a past vibe-coded project unaided** (the Discord bot). That's a pure test of P — the real-world pass/fail.

---

## 12. Glossary

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

---

*This document is the conceptual reference for AI Mirror. The implementation starts at v1 (the Mirror): a `PostToolUse` hook that logs AI-vs-you events to `.skillgate/events.jsonl`, plus a CLI that prints the weekly report.*
