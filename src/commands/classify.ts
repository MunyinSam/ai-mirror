import { dataPaths } from "../config.ts";
import { classifyAll } from "../classifier.ts";
import { readEvents } from "../log.ts";
import { loadVaultConcepts } from "../vault.ts";

export async function classifyCommand(): Promise<void> {
  const paths = dataPaths();
  const events = readEvents(paths.events);
  const vault = loadVaultConcepts();

  const { stats } = await classifyAll(
    paths.cache,
    events.map((e) => ({ code_hash: e.code_hash, snippet: e.snippet, lang: e.lang })),
    vault.map((v) => v.title)
  );

  console.log(`\nClassify — ${events.length} event(s)`);
  console.log(`   already cached: ${stats.cached}`);
  console.log(`   newly tagged:   ${stats.tagged}`);
  console.log(`   LLM-mapped:     ${stats.llmMapped} (${stats.apiCalls} API call(s))`);
  if (!process.env["ANTHROPIC_API_KEY"]) {
    console.log("   ⚠ no ANTHROPIC_API_KEY — Tier 2 vault mapping skipped (tags only)");
  }
  if (vault.length === 0) {
    console.log("   ⚠ vault has no concept notes yet — everything maps to unfiled suggestions (`mirror gaps`)");
  }
  console.log();
}
