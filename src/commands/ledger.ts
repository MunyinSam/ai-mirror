import { dataPaths } from "../config.ts";
import {
  daysUntilDecay, effectiveP, isClaimedOnly,
  loadLedger, saveLedger, setClaimedLevel, syncUnderstanding,
} from "../ledger.ts";
import { syncHandwritten } from "../sync.ts";
import { loadVaultConcepts } from "../vault.ts";

export async function ledgerCommand(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "set") return setCommand(args.slice(1));
  if (sub === "sync") return syncCommand(args.slice(1));
  return listCommand(
    args.includes("--json"),
    args.find((a) => !a.startsWith("--"))
  );
}

function listCommand(json: boolean, filter?: string): void {
  const paths = dataPaths();
  const ledger = loadLedger(paths.skills);
  syncUnderstanding(ledger, loadVaultConcepts());
  saveLedger(paths.skills, ledger);

  if (json) {
    const out = Object.fromEntries(
      Object.entries(ledger.concepts).map(([name, entry]) => [
        name,
        {
          understanding: entry.understanding,
          coding_level: entry.coding_level,
          effective_p: effectiveP(entry),
          claimed_only: isClaimedOnly(entry),
          last_produced: entry.last_produced,
          decays_in_days: daysUntilDecay(entry),
        },
      ])
    );
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const entries = Object.entries(ledger.concepts)
    .filter(([name]) => !filter || name.toLowerCase().includes(filter.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) {
    console.log(filter ? `No concept matching "${filter}".` : "Ledger is empty — run `mirror ledger sync`.");
    return;
  }

  console.log(`\nSkill Ledger — ${entries.length} concept(s)`);
  console.log("─".repeat(72));
  console.log(`${"concept".padEnd(40)} U  P(stored)  P(eff)  last produced`);
  for (const [name, entry] of entries) {
    const eff = effectiveP(entry);
    const flags = isClaimedOnly(entry) ? " ⚠ claimed-only" : "";
    const drop = daysUntilDecay(entry);
    const decayNote = drop !== null && drop <= 7 ? ` (decays in ${drop}d)` : "";
    console.log(
      `${name.padEnd(40)} ${entry.understanding}  ${String(entry.coding_level).padEnd(9)}  ${String(eff).padEnd(6)}  ${
        entry.last_produced?.slice(0, 10) ?? "never"
      }${flags}${decayNote}`
    );
  }
  console.log();
}

function setCommand(args: string[]): void {
  const [concept, levelArg] = args;
  const level = Number(levelArg);
  if (!concept || !Number.isInteger(level) || level < 1 || level > 4) {
    console.error("Usage: mirror ledger set <concept> <level 1-4>");
    process.exit(1);
  }
  const paths = dataPaths();
  const ledger = loadLedger(paths.skills);
  setClaimedLevel(ledger, concept, level);
  saveLedger(paths.skills, ledger);
  console.log(`✓ Claimed P${level} for "${concept}" — recorded as claimed (⚠), not produced.`);
  console.log("  Producing the code unaided is the only way to earn a verified level.");
}

async function syncCommand(args: string[]): Promise<void> {
  const daysIdx = args.indexOf("--days");
  const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) || 30 : 30;
  const repoIdx = args.indexOf("--repo");
  const onlyRepo = repoIdx >= 0 ? args[repoIdx + 1] : undefined;

  const result = await syncHandwritten(days, onlyRepo);
  for (const line of result.log) console.log(line);

  console.log(`\n✓ Ledger updated: ${result.evidence} new produced-evidence entr(ies).`);
  console.log(`✓ Style corpus: ${result.samples} new sample(s).`);
  if (!process.env["ANTHROPIC_API_KEY"]) {
    console.log("⚠ No ANTHROPIC_API_KEY — hunks were logged but not mapped to vault concepts.");
  }
}
