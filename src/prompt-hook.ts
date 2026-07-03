// UserPromptSubmit hook (PLAN Stage 3, T0/T3). Pure local: reads the prompt,
// matches it against the skill ledger, and prints tutor-mode context + the
// style digest for code-intent prompts. stdout becomes conversation context.
// Never blocks (always exit 0), never calls the network.
import { existsSync, readFileSync } from "node:fs";
import { dataPaths } from "./config.ts";
import { loadLedger } from "./ledger.ts";
import { buildInjection, findBeyondConcepts, hasCodeIntent } from "./tutor.ts";

const raw = await Bun.stdin.text();

try {
  const input = JSON.parse(raw) as { prompt?: string };
  const prompt = input.prompt ?? "";

  if (prompt && hasCodeIntent(prompt)) {
    const paths = dataPaths();
    const ledger = loadLedger(paths.skills);
    const hits = findBeyondConcepts(prompt, ledger);
    const digest = existsSync(paths.styleDigest)
      ? readFileSync(paths.styleDigest, "utf8")
      : null;
    const injection = buildInjection(hits, digest);
    if (injection) console.log(injection);
  }
} catch {
  // A malformed payload must never break the user's prompt.
}

process.exit(0);
