// `mirror gaps` (PLAN Stage 2, V1): everything the mirror knows that the vault
// doesn't cover, machine-readable for the /gaps skill.
//   - unfiled:  concepts the AI used that have no vault note (from suggested[])
//   - beyond:   vault concepts the AI used where your effective P is 0
//   - decaying: verified P about to drop a level
import { dataPaths } from "../config.ts";
import { loadCache } from "../classifier.ts";
import { daysUntilDecay, effectiveP, isClaimedOnly, loadLedger, syncUnderstanding } from "../ledger.ts";
import { readEvents } from "../log.ts";
import { loadArchiveConcepts, loadVaultConcepts } from "../vault.ts";

interface GapUsage {
  name: string;
  uses: number;
  last_used: string;
  /** exact/fuzzy title match in the archived vault, if any — import candidate */
  archive_match: string | null;
}

export async function gapsCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const daysIdx = args.indexOf("--days");
  const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) || 30 : 30;
  const since = new Date(Date.now() - days * 86_400_000);

  const paths = dataPaths();
  const cache = loadCache(paths.cache);
  const vault = loadVaultConcepts();
  const archive = loadArchiveConcepts();
  const ledger = loadLedger(paths.skills);
  syncUnderstanding(ledger, vault);

  const events = readEvents(paths.events).filter(
    (e) => e.author === "ai" && new Date(e.ts) >= since
  );

  const vaultTitles = new Set(vault.map((v) => v.title));
  const findArchiveMatch = (name: string): string | null => {
    const lower = name.toLowerCase();
    return (
      archive.find((a) => a.title.toLowerCase() === lower)?.title ??
      archive.find(
        (a) => a.title.toLowerCase().includes(lower) || lower.includes(a.title.toLowerCase())
      )?.title ??
      null
    );
  };

  const unfiledMap = new Map<string, { uses: number; last: string }>();
  const beyondMap = new Map<string, { uses: number; last: string }>();

  for (const e of events) {
    const entry = cache[e.code_hash];
    if (!entry) continue;
    for (const name of entry.suggested ?? []) {
      if (vaultTitles.has(name)) continue; // filed since it was suggested
      const cur = unfiledMap.get(name) ?? { uses: 0, last: "" };
      unfiledMap.set(name, { uses: cur.uses + 1, last: e.ts > cur.last ? e.ts : cur.last });
    }
    for (const name of entry.concepts) {
      const led = ledger.concepts[name];
      if (led && effectiveP(led) > 0 && !isClaimedOnly(led)) continue;
      const cur = beyondMap.get(name) ?? { uses: 0, last: "" };
      beyondMap.set(name, { uses: cur.uses + 1, last: e.ts > cur.last ? e.ts : cur.last });
    }
  }

  const toSorted = (m: Map<string, { uses: number; last: string }>): GapUsage[] =>
    [...m.entries()]
      .map(([name, v]) => ({
        name,
        uses: v.uses,
        last_used: v.last.slice(0, 10),
        archive_match: findArchiveMatch(name),
      }))
      .sort((a, b) => b.uses - a.uses);

  const unfiled = toSorted(unfiledMap);
  const beyond = toSorted(beyondMap);
  const decaying = Object.entries(ledger.concepts)
    .map(([name, entry]) => ({ name, days: daysUntilDecay(entry) }))
    .filter((d): d is { name: string; days: number } => d.days !== null && d.days <= 7)
    .sort((a, b) => a.days - b.days);

  if (json) {
    console.log(JSON.stringify({ window_days: days, unfiled, beyond, decaying }, null, 2));
    return;
  }

  console.log(`\nMirror gaps — last ${days} days`);
  console.log("─".repeat(56));

  if (unfiled.length > 0) {
    console.log(`\nUnfiled — AI used these, your vault has no note (can't be tracked):`);
    for (const g of unfiled) {
      const imp = g.archive_match ? `  [archive: "${g.archive_match}"]` : "";
      console.log(`   ✚ ${g.name.padEnd(36)} ${g.uses}× · last ${g.last_used}${imp}`);
    }
  }

  if (beyond.length > 0) {
    console.log(`\nBeyond your skill — filed, but you've never produced them (P=0):`);
    for (const g of beyond) {
      console.log(`   ⚠ ${g.name.padEnd(36)} ${g.uses}× · last ${g.last_used}`);
    }
  }

  if (decaying.length > 0) {
    console.log(`\nDecaying — verified P about to drop:`);
    for (const d of decaying) console.log(`   ⏳ ${d.name.padEnd(36)} drops in ${d.days} day(s)`);
  }

  if (unfiled.length === 0 && beyond.length === 0 && decaying.length === 0) {
    console.log("No gaps in this window. Either you're solid — or you haven't shipped.");
  }
  console.log(`\nRoute gaps with the /gaps skill: file (/add-new-concepts), fast-learn (/drill),`);
  console.log(`deep-dive (/learn), or import the archive note.\n`);
}
