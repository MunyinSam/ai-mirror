import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as readline from "node:readline";
import { CONFIG_FILE, REPO_ROOT } from "../config.ts";

const HOME = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~";
const SETTINGS_PATH = resolve(HOME, ".claude/settings.json");
const HOOK_CMD = `bun run ${REPO_ROOT}/src/hook.ts`;

function ask(question: string, defaultVal: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(`${question} [${defaultVal}]: `, (answer) => {
      rl.close();
      res(answer.trim() || defaultVal);
    });
  });
}

interface HookEntry {
  matcher?: string;
  hooks?: { type: string; command: string }[];
}

/** Replace our PostToolUse entry without clobbering any other hooks the user
 *  has configured. Ours is identified by the repo path in the command. */
export function mergeHookSettings(
  settings: Record<string, unknown>,
  hookCmd: string
): Record<string, unknown> {
  const hooks = (settings["hooks"] ?? {}) as Record<string, unknown>;
  const existing = Array.isArray(hooks["PostToolUse"])
    ? (hooks["PostToolUse"] as HookEntry[])
    : [];
  const others = existing.filter(
    (e) => !(e.hooks ?? []).some((h) => h.command.includes("ai-mirror"))
  );
  hooks["PostToolUse"] = [
    ...others,
    { matcher: "Edit|Write", hooks: [{ type: "command", command: hookCmd }] },
  ];
  settings["hooks"] = hooks;
  return settings;
}

export async function setupCommand(): Promise<void> {
  console.log("\nAI Mirror — setup\n" + "─".repeat(30));

  // 1. Data directory
  const defaultDataDir = resolve(HOME, ".skillgate/data");
  const dataDir = await ask("Where should the event log be stored?", defaultDataDir);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify({ data_dir: dataDir }, null, 2), "utf8");
  console.log(`✓ Data directory: ${dataDir}`);

  // 2. Wire the hook into ~/.claude/settings.json (idempotent, preserves other hooks)
  mkdirSync(resolve(HOME, ".claude"), { recursive: true });
  let settings: Record<string, unknown> = {};
  if (existsSync(SETTINGS_PATH)) {
    try {
      settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as Record<string, unknown>;
      console.log("✓ Found existing ~/.claude/settings.json");
    } catch {
      console.log("⚠ Could not parse ~/.claude/settings.json — starting fresh");
    }
  }
  settings = mergeHookSettings(settings, HOOK_CMD);
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf8");
  console.log(`✓ Wired PostToolUse hook → ${HOOK_CMD}`);

  // 3. .env for the report-time classifier (the hook itself never needs a key)
  const envPath = resolve(REPO_ROOT, ".env");
  if (!existsSync(envPath)) {
    writeFileSync(envPath, "ANTHROPIC_API_KEY=\n", "utf8");
    console.log("✓ Created .env — add an ANTHROPIC_API_KEY to enable vault concept mapping");
  } else {
    console.log("✓ .env already exists");
  }

  // 4. Global `mirror` command
  try {
    const { execSync } = await import("node:child_process");
    execSync("bun link", { cwd: REPO_ROOT, stdio: "inherit" });
    console.log("✓ Linked `mirror` as a global command");
  } catch {
    console.log("⚠ Could not run `bun link` — run it manually in the repo");
  }

  console.log("\nDone. Restart Claude Code for the hook to take effect.");
  console.log("Run `mirror` anytime for the weekly report.\n");
}
