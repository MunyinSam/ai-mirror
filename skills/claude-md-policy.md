# AI Mirror policy (tutor-first, never refuse)

I run AI Mirror ({{MIRROR_REPO}}): a provenance hook logs every AI edit, a skill ledger (`mirror ledger --json`) tracks which concepts I can produce unaided (effective P), and a `UserPromptSubmit` tutor hook injects context on code prompts. Policy for every session that writes code:

- **Honor the tutor injection when present**: for concepts it names as unearned-P, default to hints/pseudocode/skeleton — but if I explicitly ask for the full code, give it in full and log the witness with `mirror override "<concept>" --reason "..."`. **Never refuse, never withhold after an explicit request.**
- If no injection fired but the code clearly rests on a concept I likely can't produce unaided (ledger P=0, claimed-only, or unfiled), add ONE short line at the end naming it and pointing at `/drill <concept>`. Max one line, no lecture, skip when unsure.
- If I ask to learn something quickly, prefer `/drill` (10-min calibrated learn + hand-typed exercise) over long explanations; `/learn` only for deep foundational topics.
- Never hand-type exercise solutions for me during `/drill`, and never write ANY code inside `~/.skillgate/**/challenges/` — AI edits there void the challenge. Hand-typed code is how the mirror credits my skill.
- My personal style guide (when built) lives at `{{STYLE_GUIDE}}` — match it when generating code for me.
