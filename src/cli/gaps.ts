// `mirror gaps` — what to learn next, in three buckets:
//   unfiled       concepts the AI used with no vault note at all
//   beyond-skill  concepts filed in the vault, used by AI, P=0 for you
//   decaying      concepts whose P drops within `--days` (default 7)
// All read-only, all from classify_cache/ledger/concepts as they currently
// stand — same "never triggers classification" stance as report.ts.
import { db, type Sql } from "../db/client.ts";
import { bucketOf, daysUntilDecay } from "../domain/skill.ts";
import type { LedgerEntry } from "../types.ts";
import { c } from "./colors.ts";

async function loadLedgerByTitle(sql: Sql): Promise<Map<string, LedgerEntry>> {
  const rows = await sql<
    {
      title: string;
      understanding: number;
      coding_level: number;
      last_produced: string | null;
      decay_u_days: number;
      decay_p_days: number;
    }[]
  >`
    SELECT c.title, l.understanding, l.coding_level, l.last_produced,
           l.decay_u_days, l.decay_p_days
    FROM ledger l JOIN concepts c ON c.id = l.concept_id
  `;
  return new Map(
    rows.map((r) => [
      r.title,
      {
        concept: r.title,
        understanding: r.understanding,
        coding_level: r.coding_level,
        last_produced: r.last_produced,
        decay_days: { u: r.decay_u_days, p: r.decay_p_days },
        evidence: [],
      },
    ])
  );
}

async function unfiledCounts(sql: Sql): Promise<{ concept: string; uses: number }[]> {
  const rows = await sql<{ concept: string; uses: number }[]>`
    SELECT unnest(suggested) AS concept, count(*)::int AS uses
    FROM classify_cache
    GROUP BY 1 ORDER BY 2 DESC
  `;
  return rows;
}

async function usedConceptCounts(sql: Sql): Promise<{ concept: string; uses: number }[]> {
  const rows = await sql<{ concept: string; uses: number }[]>`
    SELECT unnest(concepts) AS concept, count(*)::int AS uses
    FROM classify_cache
    GROUP BY 1 ORDER BY 2 DESC
  `;
  return rows;
}

export async function gapsCommand(rawArgs: string[]): Promise<void> {
  const json = rawArgs.includes("--json");
  const daysIdx = rawArgs.indexOf("--days");
  const decayWindow = daysIdx >= 0 ? Number(rawArgs[daysIdx + 1]) || 7 : 7;

  const sql = db();
  const [ledger, unfiled, used] = await Promise.all([
    loadLedgerByTitle(sql),
    unfiledCounts(sql),
    usedConceptCounts(sql),
  ]);

  const beyond = used.filter((u) => bucketOf(ledger.get(u.concept)) === "beyond");
  const decaying = [...ledger.values()]
    .map((entry) => ({ concept: entry.concept, days: daysUntilDecay(entry) }))
    .filter((a): a is { concept: string; days: number } => a.days !== null && a.days <= decayWindow)
    .sort((a, b) => a.days - b.days);

  if (json) {
    console.log(JSON.stringify({ unfiled, beyond, decaying }, null, 2));
    return;
  }

  console.log("");
  console.log(c.bold(c.cyan("Gaps")));
  console.log(c.dim("─".repeat(56)));

  console.log(`\n${c.bold("Unfiled")} ${c.dim("— AI used these, no vault note exists")}`);
  if (unfiled.length === 0) console.log(c.dim("  none"));
  for (const { concept, uses } of unfiled.slice(0, 10)) {
    console.log(`  ${c.yellow("✚")} ${concept.padEnd(36)} ${uses}×  ${c.dim("→ /drill or /add-new-concepts")}`);
  }

  console.log(`\n${c.bold("Beyond your skill")} ${c.dim("— filed, AI used it, P=0 for you")}`);
  if (beyond.length === 0) console.log(c.dim("  none"));
  for (const { concept, uses } of beyond.slice(0, 10)) {
    console.log(`  ${c.red("⚠")} ${concept.padEnd(36)} ${uses}×  ${c.dim(`→ /drill ${concept}`)}`);
  }

  console.log(`\n${c.bold("Decaying")} ${c.dim(`— P drops within ${decayWindow} day(s)`)}`);
  if (decaying.length === 0) console.log(c.dim("  none"));
  for (const { concept, days } of decaying) {
    console.log(`  ${c.yellow("⏳")} ${concept.padEnd(36)} ${days} day(s)`);
  }
  console.log("");
}
