---
name: gaps
description: The bridge between AI Mirror and the vault. Reads `mirror gaps --json` and triages every gap the mirror found — concepts the AI used that have no vault note (unfiled), filed concepts the user has never produced (beyond skill), and verified skills about to decay. Routes each gap to /drill (fast learn+earn), /learn (deep dive), /add-new-concepts (just file it), or imports the matching note from the archived old vault. Use when the user says "/gaps", "what are my gaps", "what am I leaning on AI for", "triage my mirror report", or after a weekly report shows unfiled/beyond-skill concepts.
---

# Gaps

AI Mirror only tracks concepts that exist in the vault — everything else is silently invisible. This skill is how the vault grows to match reality: **demand-driven, from what the AI actually did for you** (PLAN.md Stage 2). It never teaches; it triages and routes.

## Step 0: Get the data

1. Run `mirror gaps --json` (fallback if not linked: `bun run D:/Code-3/ai-mirror/src/cli.ts gaps --json`). Default window 30 days; pass `--days N` through if the user asked for a different window.
2. Read `~/.claude/vault-config.json` for `vault_path` (the active vault) and `archive_vault_path` (the old vault, read-only, import source).
3. If all three lists are empty, say so and stop — no ceremony.

## Step 1: Present the triage board

Show the three lists compactly, worst first (highest `uses`), max ~8 rows each:

- **✚ Unfiled** — AI used it, no vault note exists, so the mirror *can't even track it*. Show `archive_match` when present — that's a 1-minute import instead of a learning session.
- **⚠ Beyond your skill** — filed, but effective P = 0: the AI is writing things you've never produced. This is the vibe-coding fingerprint.
- **⏳ Decaying** — verified P about to drop a level. Use-it-or-lose-it warnings.

Then ask which items to tackle now (suggest the top 2–3 by usage; more than 3 in one sitting kills the habit).

## Step 2: Route each chosen item

Per item, exactly one route — ask the user which, with a recommendation:

| Situation | Route |
|---|---|
| Archive has a matching note (`archive_match`) | **Import** (Step 3 below) |
| User doesn't know the concept, wants it fast | **/drill** — ~10 min, raises U and P |
| User doesn't know it, it's deep/foundational | **/learn** — the full loop |
| User already understands it, just never filed it | **/add-new-concepts** — file only (raises U; P still needs producing) |
| Decaying item | Suggest a hand-written exercise in real work this week, or **/review** to check the understanding still holds |

Rules:
- When filing or drilling an unfiled item, **use the suggested name from `mirror gaps` EXACTLY as the note's `title:`** — that string is what the classifier will match against. A renamed note breaks the loop.
- Never route more than one item to /learn per session (time cost); /drill can take 2–3.
- Beyond-skill items don't need filing (the note exists) — they need *producing*. Filing again is the U≠P trap; say so if the user suggests it.

## Step 3: Import from the archive vault (when `archive_match` exists)

1. Read the matching note from `<archive_vault_path>/concepts/**`.
2. Convert to the active vault's template (`<vault>/templates/concept.md`): keep `title`, `aliases`, `domain`, `parent`; keep the body prose.
3. **Confidence does not carry over silently.** Show the user the old `confidence:` value and ask: _"This was filed as [solid] on [date-ish]. Does that still hold?"_ — keep it only on an explicit yes; otherwise write `confidence: learning`. Stale confidence is how the ledger starts lying.
4. Write the note into the active vault under the right domain, register the domain MOC chain if new (create `concepts/<domain>/_moc.md`, link from root `concepts/_moc.md`).
5. Never modify the archive vault. It is read-only, permanently.

## Step 4: Close

- Summarize what moved: filed / imported / drilled / deferred.
- Remind once: newly filed concepts are matched in *future* classification — old events won't retroactively re-bucket.
- If anything was hand-typed during the session (via /drill), suggest `mirror ledger sync`.

Hard rule: this skill never blocks, never shames, never teaches inline. Observe → route → get out of the way (AI Mirror CONCEPTS §2: friction kills; §7 v1: observe only).
