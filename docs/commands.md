# Command Reference

Every `mirror` command in detail: what it does, what it reads and writes, and how it works inside. Written to be precise enough to re-implement from. For the system-level picture, read [how-it-works.md](how-it-works.md) first.

All data files live in the configured data dir (default `~/.skillgate/data`) — see the file inventory in how-it-works.md.

---

## `mirror` / `mirror report`

**The product.** Everything else feeds this.

```
mirror [project] [--day|--week|--month|--year] [--back N] [--files] [--json]
mirror report today|week|month|year        # bare-word aliases
```

| Flag | Meaning |
|---|---|
| `[project]` | positional path — filter to one repo |
| `--day/--week/--month/--year` | calendar period (default: week, Sun–Sat) |
| `--back N` | N periods ago (`--week 2` also works, back-compat) |
| `--files` | list every file the AI touched per repo |
| `--json` | machine-readable output (used by /mirror-week) |

**What a run actually does, in order** (`src/commands/report.ts`):

1. **Auto-sync** — runs `syncHandwritten(30)` (same code as `ledger sync`, quiet) so recent hand-written commits are credited without a manual step. Failure is swallowed.
2. **Classify** — runs `classifyAll` over every event; only uncached hashes cost anything (see classifier in how-it-works.md).
3. **Mirror U** — copies each vault note's `confidence:` into the ledger (`syncUnderstanding`), then saves the ledger.
4. **Compute the period** — for the selected window and the 3 before it (the trend):
   - **AI lines** = sum of `lines` over `author: "ai"` events in the window.
   - **You lines** = `max(0, git-lines-added − AI lines)` where git-lines-added is `git log --numstat` summed over *every known repo* (all-time event projects + `projects` from `mirror.config.json`). A subtraction, not a measurement — the report footer says "trend, not truth" for a reason.
   - **Concept buckets** — every concept the AI's code mapped to is bucketed by the ledger: `within` (effective P > 0), `beyond` (P = 0 or unknown), `claimed` (P rests on old manual claims).
   - **Clean days** = active days minus days where any beyond-skill concept was used.
5. **Render** — split bar, beyond-skill list (top 8 by use count), unfiled suggestions, overrides in the period, decay alerts (P dropping within 7 days), per-repo activity, past-period trend bars.

Reads: `events.jsonl`, `classify-cache.json`, `skills.json`, `overrides.jsonl`, vault notes, git history of known repos.
Writes: `skills.json` (U sync + auto-sync evidence), `classify-cache.json`, `style/samples.jsonl` (via auto-sync).

---

## `mirror gaps`

**The triage feed** — everything the mirror knows that your vault doesn't cover. Primarily consumed as JSON by the `/gaps` skill.

```
mirror gaps [--days N] [--json]      # default window: 30 days
```

Three buckets, computed from AI events in the window (`src/commands/gaps.ts`):

- **unfiled** — names from the classifier's `suggested[]` that still have no vault note. These are concepts the AI's code clearly rested on but the vault can't track. Each is checked against the *archive vault* (`archive_vault_path` in vault-config) for an exact/substring title match — an import candidate.
- **beyond** — vault concepts the AI used where your effective P is 0 or claimed-only. Filed ≠ able.
- **decaying** — ledger entries whose effective P drops a level within 7 days (`daysUntilDecay`).

Each entry carries `uses` (event count) and `last_used`. Read-only except the U-sync side effect.

---

## `mirror ledger`

**View the skill ledger** — one row per concept.

```
mirror ledger [filter] [--json]
```

Columns: **U** (understanding 0–3, mirrored from vault `confidence:`), **P(stored)** (highest level ever verified), **P(eff)** (stored P minus one level per full 45-day window since `last_produced` — computed at read time, stored values never destroyed), last produced date, `⚠ claimed-only` flag, decay countdown when ≤ 7 days.

`filter` is a case-insensitive substring match on the concept name. `--json` adds `claimed_only` and `decays_in_days` per concept (used by skills).

---

## `mirror ledger sync`

**The P-inference pipeline** — turns committed hand-written code into P evidence and style samples. The report auto-runs this (30 days, quiet); the standalone command exists for custom windows and because `/drill` calls it to credit an exercise immediately.

```
mirror ledger sync [--days N] [--repo path]     # default: 30 days, all known repos
```

Per repo (`src/sync.ts` → `src/handwritten.ts`):

1. `git log --no-merges --since="N days ago" -p -U0` → parse **added-line hunks** (each `@@` block's `+` lines).
2. Filter to hunks that are plausibly yours:
   - code language only (`ts/tsx/js/jsx/py`), not under `node_modules/`, ≥ 3 lines;
   - build the **AI line set**: every significant line (trimmed, ≥ 8 chars) from every logged AI snippet in this repo;
   - a hunk is dropped as AI-derived when ≥ **15%** of its significant lines appear in that set (`AI_MATCH_THRESHOLD` — deliberately strict because these hunks feed the style profile).
3. Surviving hunks are classified (same cache as everything else). Each mapped concept gets a `produced` evidence entry `{ref: "commit:<sha7>"}` — idempotent per (concept, ref) — which sets `coding_level` to at least 1 and bumps `last_produced`.
4. Each surviving hunk is appended to `style/samples.jsonl`, deduped by code hash.

**Honest limits:** code written outside the hook's sight (Copilot, browser paste, pre-mirror history) has no AI events to match against and gets credited as yours. Commit-inference proves *presence* only — it caps at P1. Challenges are the only path to P2–P4.

---

## `mirror style`

**Status + profile rebuild** for the personal style corpus.

```
mirror style               # corpus status: sample counts per language
mirror style --rebuild     # distill the profile (needs ANTHROPIC_API_KEY)
```

`--rebuild` (`src/style.ts`): groups samples by language, newest first, concatenates up to 60 000 chars per language, and asks Sonnet (forced tool call, so the response is typed JSON) to describe observable traits: naming, function shape, error handling, comments, structure, idioms, notable absences. Writes three artifacts:

- `style/profile.json` — the structured traits;
- `style/style-guide.md` — human-readable markdown, meant to be referenced from `~/.claude/CLAUDE.md`;
- `style/digest.md` — ≤ ~600 chars, injected into code prompts by the tutor hook so generated code sounds like you.

The corpus only ever contains provenance-verified hand-written hunks (from `ledger sync`). Garbage in → the profile drifts toward the AI's own style, which is why the sync threshold is strict.

---

## `mirror challenge`

**The airtight P verification** — the only path to P2–P4.

```
mirror challenge <concept>       # generate a sandbox exercise
mirror challenge grade [slug]    # provenance-check + LLM-grade (default: latest ungraded)
mirror challenge list            # all attempts with status
```

**Create:** looks up the concept's effective P and targets `min(4, P + 1)`. Sonnet generates (forced tool) a self-contained 15–60 line exercise, a 3–6 item pass/fail rubric, and a solution filename, into `challenges/<slug>-<date>/` with `meta.json`, `README.md`, and an empty solution file. You hand-type the solution.

**Grade:** two phases, in this order —

1. **Provenance:** if *any* AI event's file path lies inside the sandbox directory, the attempt is **VOID** — no grading, start fresh. Authorship is certain by construction, which is what makes a pass trustworthy.
2. **Rubric:** Sonnet grades strictly against the stored rubric (minor style issues pass, unmet rubric items fail). On pass: `produced` evidence `{ref: "challenge:<slug>"}`, `coding_level = max(current, level)`, `last_produced = now`. On fail: the attempt stays regradeable.

Requires `ANTHROPIC_API_KEY` for both generation and grading.

---

## `mirror override`

**The witness.** Shipping beyond your P is always allowed — it just gets counted.

```
mirror override <concept> [--reason "why"]
```

Appends `{ts, concept, project: cwd, reason}` to `overrides.jsonl` and prints the running total for that concept. The weekly report lists overrides per concept with a `/drill` pointer.

You rarely run this by hand: the tutor injection (see below) instructs *Claude* to run it after honoring an explicit "just give me the code" during tutor mode. Never refused, always counted — that's the whole philosophy.

---

## `mirror gate`

**The universal net** — a git pre-commit *advisory* that assesses everything staged regardless of who wrote it, closing the hook's blind spots (Copilot, browser paste, Bash-written code) at commit time.

```
mirror gate install [repo]      # write/chain .git/hooks/pre-commit
mirror gate uninstall [repo]    # remove ours, restore what it chained
mirror gate check               # what the hook runs
```

**check** (`src/commands/gate.ts` + `src/gate.ts`): reads `git diff --cached -U0`, keeps code hunks ≥ 3 lines, then:

- computes the **staged AI %** — share of significant staged lines matching the AI snippet log;
- classifies the hunks (cache first; uncached ones get one LLM call with a **5-second timeout** and no retries — a timeout means silence now, classification at the next report);
- judges each mapped concept against the ledger: beyond (P=0 or unknown — *unknown is beyond by definition; P is earned, never assumed*), claimed-only, within, plus unfiled suggestions;
- prints the advisory and appends it to `gate.jsonl` — the dataset that will eventually answer "is advisory enough?" with data.

Invariants: **always exits 0, fails open** (no key / timeout / any error → silence, never a blocked commit). If nothing got a Tier-2 verdict, it says so and stays quiet rather than guessing from syntax tags alone.

**install:** writes a `#!/bin/sh` pre-commit that runs `gate check || true`. A pre-existing foreign hook is renamed to `pre-commit.pre-mirror` and chained *first with its blocking power intact*. `uninstall` reverses this exactly. Refuses (rather than guesses) if both a foreign hook and a chained backup already exist.

---

## `mirror setup`

**The installer.** Seven steps, all idempotent — safe to re-run anytime (it's also how you refresh machine-specific paths after syncing dotfiles from another machine).

1. **Data directory** — prompts (default: existing config's value, else `~/.skillgate/data`); merges into `mirror.config.json` without clobbering other keys like `projects`.
2. **Claude Code hooks** — merges two entries into `~/.claude/settings.json`, identified by the repo path so re-runs replace ours and never touch other hooks: `PostToolUse` (matcher `Edit|Write`) → capture, `UserPromptSubmit` → tutor.
3. **API key** — prompts only when `.env` is missing or its key line is empty; never touches a set key.
4. **Vault** — reports an existing `~/.claude/vault-config.json`; otherwise offers a minimal scaffold (`concepts/` + root MOC + concept template), defaulting to your most recently open Obsidian vault when the Obsidian registry is readable.
5. **Companion skills** — copies `/gaps`, `/drill`, `/mirror-week` into `~/.claude/skills/`, substituting `{{MIRROR_REPO}}` and `{{STYLE_GUIDE}}` placeholders with this machine's paths.
6. **Gate** — offers `gate install` into a repo path (default: skip).
7. **CLAUDE.md policy** — appends (or refreshes, by marker heading) the tutor-first/never-refuse policy block in `~/.claude/CLAUDE.md`.

Finally `bun link` registers the global `mirror` command (a symlink to this repo's `cli.ts` — code changes apply without re-linking).

---

## Removed commands (design history)

- **`classify`** — redundant; the report classifies lazily on every run.
- **`ledger set`** — manual "claimed" P attestations; cut because nothing depended on it and self-reported skill contradicts the system's own rule that P is produced, never declared. Old `claimed` evidence in data files still renders with ⚠.
- **`migrate`** — one-time v1→v2 log upgrade; recoverable from git history.
