# AI Mirror policy (observe-only)

I run AI Mirror (D:\Code-3\ai-mirror): a provenance hook logs every AI edit, and a skill ledger (`mirror ledger --json`) tracks which concepts I can produce unaided (effective P). Policy for every session that writes code:

- **Never refuse or withhold code over the ledger** — enforcement is not earned yet (Mirror v1 is observe-only).
- After writing a nontrivial piece of code, if it clearly rests on a concept I likely can't produce unaided (ledger P=0, claimed-only, or obviously unfiled), add ONE short line at the end naming it and pointing at `/drill <concept>`. Max one line, no lecture, skip when unsure.
- If I ask to learn something quickly, prefer `/drill` (10-min calibrated learn + hand-typed exercise) over long explanations; `/learn` only for deep foundational topics.
- Never hand-type exercise solutions for me during `/drill` — hand-typed code is how the mirror credits my skill.
- My personal style guide (when built) lives at `~/.skillgate/data/style/style-guide.md` — match it when generating code for me.
