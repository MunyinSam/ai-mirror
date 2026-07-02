---
name: mirror-week
description: The weekly AI Mirror accountability ritual (~15 min) — run the report, triage gaps, review decaying skills, refresh the style profile if the corpus grew, and end with the one public number. Use when the user says "/mirror-week", "weekly mirror", "run my week", "Friday review", or asks for their weekly AI-usage accountability session.
---

# Mirror Week

The accountability layer from AI Mirror CONCEPTS §8, as a ritual: the consequence isn't a wall, it's **a witness**. One sitting, ~15 minutes, same order every time so it becomes automatic.

Run the steps in order; keep commentary minimal — the numbers talk.

## Step 1: The report (2 min)

Run `mirror report` (fallback: `bun run D:/Code-3/ai-mirror/src/cli.ts report`) and show it in full. Call out exactly three things, one line each:
- AI% vs last week (the trend line) — up, down, or flat.
- The beyond-skill count and its heaviest concept.
- The clean-days streak.

No moralizing. The mirror states; it doesn't lecture.

## Step 2: Gap triage (5–8 min)

Invoke the **/gaps** skill. Cap the session at 2–3 routed items — the ritual must stay cheap enough to survive (CONCEPTS §2: a gentle mirror you keep beats a blocker you rage-quit).

## Step 3: Decay check (2 min)

For anything in the decaying list the user wants to keep: agree on ONE concrete spot in next week's real work where they'll hand-write it (not an artificial exercise — real work counts and gets picked up by `ledger sync`). If they can't name a spot, offer `/review` to at least verify the understanding still holds.

## Step 4: Style refresh (1 min, conditional)

Run `mirror style`. If the sample count grew meaningfully since the last profile build (rule of thumb: +30% or +20 samples), suggest `mirror style --rebuild` and run it on a yes. Otherwise skip silently.

## Step 5: The public number (1 min)

End with one line, formatted to be pasted anywhere (chat, tweet, a friend):

> Week of [date]: **[N]% AI-written · [M] concepts beyond my skill · [K]-day clean streak.**

Ask nothing after it. The ritual ends on the number — identity and a witness beat friction (CONCEPTS §8).

## Guardrails

- Never skip Step 1 to "get to the interesting part" — the report IS the ritual.
- Never let the session exceed ~4 routed learning items total; defer the rest to next week.
- If the user skipped several weeks, do NOT back-fill guilt: run the current week (`mirror report`), note `--week 1..N` exists if they're curious, move on.
