---
name: drill
description: Fast learn-and-earn loop for one coding concept in ~10 minutes — calibrate, explain directly, hand-type one micro-exercise, file the note. Use when the user says "/drill X", "quick-learn X", "learn X fast", "I don't have 30 minutes for /learn", or when /gaps routes a concept here. Unlike /learn there is NO Socratic loop — but unlike /snap it never assumes prior knowledge (it calibrates first) and it always ends with the user hand-typing real code, which the AI Mirror provenance layer credits as coding ability (P). Never types the exercise for the user.
---

# Drill

One concept, ~10 minutes, both ledger numbers raised: **U** (a vault note exists) and **P** (you produced code by hand). This is the compressed earn loop from AI Mirror's CONCEPTS §4: learn it → produce it.

The two disciplines that make it work:

1. **Never assume prior knowledge.** /learn assumes context; /snap dumps an answer. Drill starts by asking what the user already knows and pitches the explanation there.
2. **Never type the exercise for them.** If Claude writes the code via Edit/Write, the AI Mirror hook logs it as *AI-authored* and the user earns nothing. The user must physically type it. This is non-negotiable — it is the entire mechanism by which P gets credited.

## Step 0: Resolve context (≤30s)

1. Read `~/.claude/vault-config.json` → `vault_path`. If missing, route to `init-vault` and stop.
2. Identify the concept from the invocation (e.g. `/drill Python Decorator Factory`). If ambiguous, ask one clarifying question, not a menu.
3. Check `<vault>/concepts/` for an existing note (title or alias match). If one exists with `confidence: solid` or `fluent`, say so and offer `/review` instead — drilling something already known wastes the ritual.

## Step 1: Calibrate (one question, ~30s)

Ask exactly one question: _"Before I explain — what do you already know about [X]? (nothing / seen it around / used it but couldn't write it)"_

Wait for the answer. It sets the floor of the explanation:
- **nothing** → start from the problem the concept solves, zero jargon.
- **seen it** → skip motivation, go straight to the mechanism.
- **used it** → focus only on the part they couldn't write cold.

If a related note exists in the vault, anchor the explanation to it ("you already filed [[Y]] — X is Y but for…"). One anchor max.

## Step 2: Explain directly (≤5 min read)

No Socratic drip, no withheld answers. Give:
1. The problem it solves (one paragraph).
2. The mechanism — how it actually works (the core of the explanation).
3. One minimal, complete code example, walked through line by line.
4. The one classic gotcha.

Stop there. No history lessons, no exhaustive variants, no "advanced usage" section. If the user asks a follow-up, answer it; don't preempt it.

## Step 3: The hand-typed exercise (~3 min)

Design ONE micro-exercise: 5–15 lines, a *variation* of the example (never copy-typing), placed in a real project file if the current repo has a natural spot, otherwise `drill/<concept-slug>.<ext>` in the current repo.

Present it as a spec, not code: _"In [file], write a function that [does Y]. Constraints: [1-2 constraints that force the mechanism]."_

**Do not write the solution. Do not scaffold the file with Edit/Write.** The user types; hand-typed code fires no hook, so the provenance layer attributes it to them.

When they say done, read the file and review it: correct → say exactly why it's correct; wrong → point at the line and let them fix it (still no typing for them). One fix cycle is enough — perfection is not the goal, production is.

## Step 4: File the note (~1 min)

Create the concept note yourself (notes are not code — the hook logging it as AI doesn't matter; only the classifier's CODE_LANGS get tracked):
1. Use `<vault>/templates/concept.md`. Frontmatter: `title` (canonical name — if /gaps suggested this concept, use the suggested name EXACTLY so the mirror's namespace matches), `domain`, `parent`, `status: filed`, `confidence: learning`.
2. Body: 2–4 sentences in the user's own framing (ask them to summarize it back in one sentence; use their words), plus their exercise code as the example.
3. Register the domain MOC chain if the domain is new (create `concepts/<domain>/_moc.md`, link from `concepts/_moc.md`).

## Step 5: Close the loop (~30s)

Tell them, verbatim shape: _"Commit the exercise, then run `mirror ledger sync` — that's what turns this into verified P."_ If they agree, run the sync for them and show the ledger line for the concept.

Done. Total target: 10 minutes. If the concept genuinely can't be explained in one sitting (it's a domain, not a concept — "distributed systems"), say so and route to `/learn` instead of stretching the drill.
