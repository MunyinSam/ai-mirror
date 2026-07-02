#!/usr/bin/env bun
import { loadEnv } from "./config.ts";

const HELP = `
AI Mirror — watches the code you write with AI and tells you honestly
how much of it you couldn't have written yourself.

Usage: mirror <command> [options]

Commands:
  report [project] [--week N] [--json]   weekly report (default command)
  classify                               classify uncached events (tags + vault concepts)
  gaps [--days N] [--json]               unfiled / beyond-skill / decaying concepts
  ledger [filter]                        view the skill ledger
  ledger sync [--days N] [--repo path]   infer P + style samples from hand-written commits
  ledger set <concept> <level>           manual claim (recorded as ⚠ claimed, not produced)
  style [--rebuild]                      style corpus status / rebuild the style profile
  setup                                  wire the Claude Code hook + data directory
  migrate                                upgrade a v1 event log to schema v2
  help                                   show this help
`;

loadEnv();

const [cmd = "report", ...rest] = process.argv.slice(2);

switch (cmd) {
  case "report": {
    const { reportCommand } = await import("./commands/report.ts");
    await reportCommand(rest);
    break;
  }
  case "classify": {
    const { classifyCommand } = await import("./commands/classify.ts");
    await classifyCommand();
    break;
  }
  case "gaps": {
    const { gapsCommand } = await import("./commands/gaps.ts");
    await gapsCommand(rest);
    break;
  }
  case "ledger": {
    const { ledgerCommand } = await import("./commands/ledger.ts");
    await ledgerCommand(rest);
    break;
  }
  case "style": {
    const { styleCommand } = await import("./commands/style.ts");
    await styleCommand(rest);
    break;
  }
  case "setup": {
    const { setupCommand } = await import("./commands/setup.ts");
    await setupCommand();
    break;
  }
  case "migrate": {
    const { migrateCommand } = await import("./commands/migrate.ts");
    migrateCommand();
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
