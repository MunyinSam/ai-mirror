#!/usr/bin/env bun
import { closeDb } from "../db/client.ts";

const HELP = `
AI Mirror — watches the code you write with AI and tells you honestly
how much of it you couldn't have written yourself.

Usage: mirror [command] [options]     running \`mirror\` alone shows this week's report

  report [repo]     you-vs-AI lines, concepts beyond your skill, trend
                      --day / --week / --month / --year · --back N · --json
  classify          run Tier 1+2 classification over uncached events
                      (the only command that spends API money; cached hashes are free)
  ledger [filter]   the skill ledger — U and P per concept · --json
  gaps              what to learn next: unfiled, beyond-skill, decaying
                      --days N · --json
  help              show this help
`;

const [cmd = "report", ...rest] = process.argv.slice(2);

try {
  switch (cmd) {
    case "report": {
      const { reportCommand } = await import("./report.ts");
      await reportCommand(rest);
      break;
    }
    case "classify": {
      const { classifyCommand } = await import("./classify.ts");
      await classifyCommand();
      break;
    }
    case "ledger": {
      const { ledgerCommand } = await import("./ledger.ts");
      await ledgerCommand(rest);
      break;
    }
    case "gaps": {
      const { gapsCommand } = await import("./gaps.ts");
      await gapsCommand(rest);
      break;
    }
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      console.log(HELP);
      process.exit(1);
  }
} finally {
  await closeDb();
}
