# The line-attribution algorithm

This is the answer to the one question the whole project exists to ask
honestly: **of the lines you shipped, how many could you not have written
yourself?**

## The pipeline it lives inside

```
capture (hook)  →  ingest (queue → Postgres, idempotent)  →  attribution
```

- **Capture** (`src/capture/hook.ts`): every time Claude Code edits or writes
  a file, a `PostToolUse` hook appends one event — `before` text, `after`
  text, file, timestamp — to a local JSONL queue. No network, no database,
  cannot fail: this step must never slow down or break your editing loop.
- **Ingest** (`src/ingest/drain.ts`): a separate step reads the queue,
  computes a real added/removed line diff, and inserts into Postgres'
  `events` table. Idempotent — `ON CONFLICT (event_uid) DO NOTHING` means
  draining the same file twice is always safe.
- **Attribution** (`src/enrich/attribute.ts`, `src/enrich/attributeCommit.ts`):
  the part below. It runs once per **commit**, not once per edit — because a
  git commit is the only point where "what actually shipped" is well-defined.
  Edits get rewritten, reverted, and abandoned constantly; commits don't.

## Why not just match AI output directly?

The first version of this tool kept one global set of "lines the AI has ever
written" and checked commits against it. Two bugs fell out of that:

1. **Reformatting broke the match.** `const x=1;` and `const x = 1;` are the
   same code, different strings — an exact match says they're unrelated.
2. **Common lines created false credit.** `return null;` gets written by AI
   and by humans, constantly, independently. One coincidental match isn't
   evidence of anything.
3. **No time or file scope.** An AI line from January stayed in the set
   forever, so an identical human line typed in July got wrongly credited
   to AI — and a git-log-wide search made this worse, not better.
4. **Churn counted as delivery.** Summing every AI edit event counts a
   function that got written, rewritten, and deleted eight times as eight
   times the "AI lines" — even though zero of it shipped.

The fix: attribute at **commit time**, scoped to **one file** and a
**bounded time window**, using **normalized** line comparison and a
**minimum run length** before trusting a match.

## The algorithm, step by step

Given one commit and one file it touched:

**1. Get the file's added lines from git.**
`git show -p -U0 -M <sha>` — `-U0` means zero context lines, so every `+`
line under that file's diff header is a genuinely added line, nothing else.
`-M` enables rename detection, so a pure `git mv` with no content change
produces no added lines at all (renaming a file isn't writing code).

**2. Get the AI's candidate snippets for that file.**
Query `events` for this exact file, with `ts` between the *previous* commit
that touched this repo and *this* commit. File-scoped and time-windowed —
this is what stops a January AI line from haunting a July human line.

**3. Normalize every line on both sides.**
`normalizeKey(line) = line.trim().replace(/\s+/g, " ")` — trims the edges
and collapses internal whitespace runs to one space. Reindentation and most
reformatting can't defeat the match anymore, because both the AI's snippet
and the committed line get reduced to the same canonical form before they're
ever compared. (Honest limit: only *whitespace* is normalized — a quote-style
change, e.g. `'x'` → `"x"`, still breaks the match.)

**4. Mark each added line: does its normalized form appear in the AI's
normalized snippets?**
This produces a `boolean[]`, one entry per added line — the raw signal,
still gullible to coincidence.

**5. Coalesce: keep only runs of 3+ consecutive matches.**
A single matched line is thrown out; three or more in a row survive. The
intuition: one shared line proves nothing, but a whole matching block is not
a coincidence. `runMin = 3` is a tuning constant, not a law — it's a
deliberate bias toward *undercounting* AI (a short 2-line AI edit gets
counted as human) over *overcounting* it (a coincidental common line getting
credited to AI). For a self-honesty tool, the conservative failure is the
safer one.

**6. Count and store.**
`ai_lines` = surviving matched lines. `human_lines` = everything else
(a `GENERATED ALWAYS AS (added_lines - ai_lines)` column in Postgres — the
invariant `ai + human = added` can't drift, because the database enforces
it, not application code). One row per `(commit, file)` in `attributions`.

**7. Aggregate.**
The headline number is just `sum(ai_lines) / sum(added_lines)` across every
row — one denominator, both sides measured the same way, no subtraction, no
clamping.

## Worked examples

**100% AI** — committed lines exactly match a prior AI event for that file →
every line survives the run-length check → `ai_lines = added_lines`.

**100% human** — no AI event exists for that file/window → the candidate set
is empty → every line fails the match → `ai_lines = 0`.

**Interleaved** — one commit adds a 3-line AI block and 2 human lines →
`marks = [true, true, true, false, false]` → the first run survives (length
3), the rest were never true → `ai_lines = 3, human_lines = 2`.

**Lone coincidental match** — only `return null;` matches, nothing around it
→ `marks = [false, true, false]` → run length 1, below `runMin` → demoted to
`false` → `ai_lines = 0`.

**Reindented AI code** — AI wrote 4-space indent, committed as 2-space →
`.trim()` strips leading whitespace on both sides before comparison → still
matches → `ai_lines = added_lines`.

**AI-written-then-deleted-before-commit** — no special-case code needed:
step 1 only looks at lines that survived into the commit's diff, so anything
the AI wrote and you deleted before committing was never a candidate to
match in the first place. It contributes nothing to either side.

**Pure rename** — `git mv`, no content change → step 1 finds zero added
lines → no `attributions` row is created at all.

## Known limitations

- `normalizeKey` only absorbs whitespace differences, not other formatting
  (quote style, trailing commas, semicolons).
- The candidate window is scoped to "since the previous commit in the repo"
  (not per-file), which is simpler than an ideal per-file window but
  slightly coarser — a very active repo could occasionally pull in a
  candidate from an unrelated file's edit in between.
- `runMin = 3` trades false positives for false negatives in one specific,
  deliberate direction (see step 5). It's an empirical knob, not a derived
  constant — worth tuning once more real data exists.
- A system directory that happens to be a git repo (e.g. Homebrew's install
  prefix at `/opt/homebrew`) can get miscategorized as a "project" via
  `gitRepoRoot()`. Guarded explicitly via `isExcludedRepo()` in
  `src/types.ts` — see `EXCLUDED_REPO_PATTERNS`.
