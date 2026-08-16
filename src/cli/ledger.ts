// `mirror ledger` — the skill scoreboard, straight from the DB. No sync/
// crediting step exists yet (nothing currently writes `evidence` rows from
// attributed human commits) — that's a real gap, not hidden: until it's
// built, this table stays empty for everything except concepts credited by
// hand (`mirror override`, once that exists).
import { db, type Sql } from "../db/client.ts";
import { bucketOf, daysUntilDecay, effectiveP, type SkillBucket } from "../domain/skill.ts";
import type { LedgerEntry } from "../types.ts";
import { c } from "./colors.ts";

interface LedgerRow {
  entry: LedgerEntry;
  bucket: SkillBucket;
  effective_p: number;
  days_until_decay: number | null;
}

async function loadAll(sql: Sql): Promise<LedgerRow[]> {
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
    ORDER BY c.title
  `;
  const evidenceRows = await sql<
    { title: string; type: "produced" | "claimed"; ref: string; date: string }[]
  >`
    SELECT c.title, e.type, e.ref, e.date
    FROM evidence e
    JOIN ledger l ON l.concept_id = e.concept_id
    JOIN concepts c ON c.id = l.concept_id
  `;
  const evidenceByTitle = new Map<string, LedgerEntry["evidence"]>();
  for (const e of evidenceRows) {
    const list = evidenceByTitle.get(e.title) ?? [];
    list.push({ type: e.type, ref: e.ref, date: e.date });
    evidenceByTitle.set(e.title, list);
  }

  return rows.map((r) => {
    const entry: LedgerEntry = {
      concept: r.title,
      understanding: r.understanding,
      coding_level: r.coding_level,
      last_produced: r.last_produced,
      decay_days: { u: r.decay_u_days, p: r.decay_p_days },
      evidence: evidenceByTitle.get(r.title) ?? [],
    };
    return {
      entry,
      bucket: bucketOf(entry),
      effective_p: effectiveP(entry),
      days_until_decay: daysUntilDecay(entry),
    };
  });
}

function bucketIcon(b: SkillBucket): string {
  return b === "within" ? c.green("✓") : b === "claimed" ? c.yellow("~") : c.red("⚠");
}

export async function ledgerCommand(rawArgs: string[]): Promise<void> {
  const json = rawArgs.includes("--json");
  const filter = rawArgs.find((a) => !a.startsWith("--"));

  const rows = (await loadAll(db())).filter(
    (r) => !filter || r.entry.concept.toLowerCase().includes(filter.toLowerCase())
  );

  if (json) {
    console.log(
      JSON.stringify(
        rows.map((r) => ({
          concept: r.entry.concept,
          understanding: r.entry.understanding,
          coding_level: r.entry.coding_level,
          effective_p: r.effective_p,
          bucket: r.bucket,
          days_until_decay: r.days_until_decay,
        })),
        null,
        2
      )
    );
    return;
  }

  if (rows.length === 0) {
    console.log(c.dim("\nLedger is empty — nothing has credited P or U yet.\n"));
    return;
  }

  console.log("");
  console.log(c.bold(c.cyan("Skill ledger")));
  console.log(c.dim("─".repeat(56)));
  for (const r of rows) {
    const decay = r.days_until_decay !== null ? c.dim(` (decays in ${r.days_until_decay}d)`) : "";
    console.log(
      `${bucketIcon(r.bucket)} ${r.entry.concept.padEnd(36)} U${r.entry.understanding} P${r.effective_p}${decay}`
    );
  }
  console.log("");
}
