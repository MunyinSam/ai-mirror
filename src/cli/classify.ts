// `mirror classify` — the only thing that calls classifyAll(). Kept
// separate from `report` on purpose: classification makes real (if cheap,
// cached-after-first-run) API calls, and viewing a report should never
// silently trigger spend. Run this explicitly, then `mirror report`.
import { db } from "../db/client.ts";
import { classifyAll } from "../enrich/classify.ts";
import { c } from "./colors.ts";

export async function classifyCommand(): Promise<void> {
  const sql = db();

  const events = await sql<{ code_hash: string; after_text: string; lang: string }[]>`
    SELECT DISTINCT ON (code_hash) code_hash, after_text, lang FROM events
  `;
  const vaultTitles = (await sql<{ title: string }[]>`SELECT title FROM concepts`).map(
    (r) => r.title
  );

  const stats = await classifyAll(
    sql,
    events.map((e) => ({ code_hash: e.code_hash, snippet: e.after_text, lang: e.lang })),
    vaultTitles
  );

  console.log("");
  console.log(c.bold(c.cyan("Classify")));
  console.log(c.dim("─".repeat(40)));
  console.log(`already cached      ${stats.cached}`);
  console.log(`tagged (Tier 1)     ${stats.tagged}`);
  console.log(`mapped (Tier 2)     ${stats.llmMapped}`);
  console.log(`API calls made      ${stats.apiCalls}`);
  console.log(`near-miss resolved  ${stats.nearMissResolved}`);
  console.log(
    c.dim(
      process.env["ANTHROPIC_API_KEY"]
        ? "\nRe-run any time — cached hashes cost zero API calls."
        : "\nNo ANTHROPIC_API_KEY set — only free Tier 1 tags were computed."
    )
  );
  console.log("");
}
