// mirror gate — the v3 pre-commit advisory (CONCEPTS §7).
//   check      run the advisory on the staged diff (what the hook calls)
//   install    write/chain .git/hooks/pre-commit in a repo
//   uninstall  remove our hook, restore whatever it chained
//
// `check` NEVER exits non-zero and never blocks a commit — a misfiring
// classifier must not feel arbitrary. Every advisory is appended to
// gate.jsonl so the weekly report can eventually answer "is advisory
// enough?" with data instead of a guess.
import { execSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyAll } from "../classifier.ts";
import { c } from "../colors.ts";
import { dataPaths, REPO_ROOT } from "../config.ts";
import { assessStaged, hunkInputs, stagedAiPct, stagedCodeHunks } from "../gate.ts";
import { parseAddedHunks } from "../handwritten.ts";
import { loadLedger } from "../ledger.ts";
import { readEvents } from "../log.ts";
import { gitRepoRoot, normalizePath } from "../util.ts";
import { loadVaultConcepts } from "../vault.ts";

/** Commit-time budget per LLM batch; a timeout falls back to cache/tags and
 *  the missed hunks get classified at the next report instead. */
const GATE_LLM_TIMEOUT_MS = 5000;

const HOOK_MARKER = "AI Mirror gate";
const CHAINED_SUFFIX = ".pre-mirror";

async function gateCheck(): Promise<void> {
  const repo = gitRepoRoot(process.cwd());
  if (!repo) return;

  const diff = execSync("git diff --cached -U0 --no-color", {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
  });
  const hunks = stagedCodeHunks(parseAddedHunks(diff));
  if (hunks.length === 0) return;

  const paths = dataPaths();
  const events = readEvents(paths.events).filter((e) => normalizePath(e.project) === repo);
  const aiPct = stagedAiPct(hunks, events);

  const inputs = hunkInputs(hunks);
  const vaultTitles = loadVaultConcepts().map((v) => v.title);
  const { cache } = await classifyAll(paths.cache, inputs, vaultTitles, {
    timeoutMs: GATE_LLM_TIMEOUT_MS,
    maxRetries: 0,
  });
  const result = assessStaged(inputs, cache, loadLedger(paths.skills));

  if (!result.assessed) {
    console.log(c.dim("AI Mirror gate: classifier unavailable — nothing checked (fails open)"));
    return;
  }

  appendFileSync(
    paths.gateLog,
    JSON.stringify({
      ts: new Date().toISOString(),
      project: repo,
      ai_pct: aiPct,
      beyond: result.beyond,
      claimed_only: result.claimedOnly,
      unfiled: result.unfiled,
    }) + "\n",
    "utf8"
  );

  if (result.beyond.length === 0 && result.claimedOnly.length === 0 && result.unfiled.length === 0) {
    console.log(c.dim("AI Mirror gate ✓ staged code is within your verified skill"));
    return;
  }

  const provenance = aiPct === null ? "" : ` · ~${aiPct}% matches the AI log`;
  console.log(c.dim(`── ${HOOK_MARKER} · advisory, never blocks${provenance} ──`));
  if (result.beyond.length > 0) {
    console.log(`  ${c.yellow("⚠ beyond your skill:")} ${result.beyond.join(", ")}`);
  }
  if (result.claimedOnly.length > 0) {
    console.log(`  ${c.yellow("⚠ claimed, never verified:")} ${result.claimedOnly.join(", ")}`);
  }
  if (result.unfiled.length > 0) {
    console.log(`  ${c.dim("· unfiled concepts:")} ${result.unfiled.join(", ")}`);
  }
  console.log(c.dim("  committing anyway is fine — /drill <concept> is 10 minutes"));
}

/** The generated hook. Chains any pre-existing hook first WITH its blocking
 *  power intact; our own advisory can never fail the commit. */
function hookScript(): string {
  const cli = resolve(REPO_ROOT, "src/cli.ts").replace(/\\/g, "/");
  return `#!/bin/sh
# ${HOOK_MARKER} (advisory) — installed by \`mirror gate install\`.
# Never blocks: the mirror's findings always exit 0. A pre-existing hook
# (chained below) keeps its own power to fail the commit.
HERE="$(dirname "$0")"
if [ -e "$HERE/pre-commit${CHAINED_SUFFIX}" ]; then
  "$HERE/pre-commit${CHAINED_SUFFIX}" "$@" || exit $?
fi
bun run "${cli}" gate check || true
exit 0
`;
}

function hooksDir(repo: string): string {
  const out = execSync("git rev-parse --git-path hooks", {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  return resolve(repo, out);
}

/** Also called by `mirror setup`'s gate offer — reports failure instead of
 *  exiting so setup can continue. */
export function gateInstall(target?: string): boolean {
  const repo = gitRepoRoot(target ?? process.cwd());
  if (!repo) {
    console.error(`Not a git repository: ${target ?? process.cwd()}`);
    return false;
  }
  const hookPath = resolve(hooksDir(repo), "pre-commit");
  const chainedPath = hookPath + CHAINED_SUFFIX;

  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, "utf8");
    if (existing.includes(HOOK_MARKER)) {
      writeFileSync(hookPath, hookScript(), "utf8");
      console.log(`✓ Refreshed the gate hook in ${repo}`);
      return true;
    }
    if (existsSync(chainedPath)) {
      console.error(`⚠ Both a foreign pre-commit and ${chainedPath} exist — untangle them by hand first.`);
      return false;
    }
    renameSync(hookPath, chainedPath);
    console.log(`✓ Existing pre-commit hook preserved (chained as pre-commit${CHAINED_SUFFIX})`);
  }

  writeFileSync(hookPath, hookScript(), "utf8");
  try {
    chmodSync(hookPath, 0o755);
  } catch {
    // Windows: git's sh runs hooks regardless of the executable bit.
  }
  console.log(`✓ Gate installed: ${hookPath}`);
  console.log(c.dim("  Advisory only — it reads the staged diff, names beyond-skill concepts, never blocks."));
  return true;
}

function gateUninstall(target?: string): void {
  const repo = gitRepoRoot(target ?? process.cwd());
  if (!repo) {
    console.error(`Not a git repository: ${target ?? process.cwd()}`);
    process.exit(1);
  }
  const hookPath = resolve(hooksDir(repo), "pre-commit");
  const chainedPath = hookPath + CHAINED_SUFFIX;

  if (!existsSync(hookPath) || !readFileSync(hookPath, "utf8").includes(HOOK_MARKER)) {
    console.log(`No gate hook installed in ${repo}`);
    return;
  }
  rmSync(hookPath);
  if (existsSync(chainedPath)) {
    renameSync(chainedPath, hookPath);
    console.log(`✓ Gate removed; original pre-commit hook restored in ${repo}`);
  } else {
    console.log(`✓ Gate removed from ${repo}`);
  }
}

export async function gateCommand(rawArgs: string[]): Promise<void> {
  const [sub = "check", ...rest] = rawArgs;
  switch (sub) {
    case "check":
      try {
        await gateCheck();
      } catch {
        // Fail open, silently: a broken mirror must never break a commit.
      }
      break;
    case "install":
      if (!gateInstall(rest[0])) process.exit(1);
      break;
    case "uninstall":
      gateUninstall(rest[0]);
      break;
    default:
      console.error(`Unknown gate subcommand: ${sub} (use check | install | uninstall)`);
      process.exit(1);
  }
}
