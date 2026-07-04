#!/usr/bin/env bun
import { loadEnv } from "./config.ts";

const HELP = `
AI Mirror — watches the code you write with AI and tells you honestly
how much of it you couldn't have written yourself.

Usage: mirror [command] [options]     running \`mirror\` alone shows this week's report

  report [project]     you-vs-AI lines, concepts beyond your skill, trend
                         --day / --week / --month / --year · --back N · --files · --json
  gaps                 what to learn next: unfiled, beyond-skill, decaying
                         --days N · --json
  ledger [filter]      the skill ledger — U and P per concept
  ledger sync          credit hand-written commits as P evidence + style samples
                         --days N · --repo <path>
  style                style corpus status · --rebuild distills your personal profile
  challenge <concept>  hand-type a no-AI exercise to earn verified P
                         then: challenge grade · challenge list
  override <concept>   witness that you shipped beyond your P · --reason "..."
  gate install [repo]  pre-commit advisory — never blocks · also: uninstall, check
  setup                wire hooks, API key, vault, skills, and the gate
  help                 show this help
`;

loadEnv();

const [cmd = "report", ...rest] = process.argv.slice(2);

switch (cmd) {
  case "report": {
    const { reportCommand } = await import("./commands/report.ts");
    await reportCommand(rest);
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
  case "challenge": {
    const { challengeCommand } = await import("./commands/challenge.ts");
    await challengeCommand(rest);
    break;
  }
  case "override": {
    const { overrideCommand } = await import("./commands/override.ts");
    overrideCommand(rest);
    break;
  }
  case "gate": {
    const { gateCommand } = await import("./commands/gate.ts");
    await gateCommand(rest);
    break;
  }
  case "setup": {
    const { setupCommand } = await import("./commands/setup.ts");
    await setupCommand();
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
