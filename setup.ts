import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import * as readline from "readline";

const HOME = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~";
const SETTINGS_PATH = resolve(HOME, ".claude/settings.json");
const REPO_ROOT = resolve(import.meta.dir);
const HOOK_CMD = `bun run ${REPO_ROOT}/hooks/post-tool-use.ts`;
const CONFIG_PATH = resolve(REPO_ROOT, "mirror.config.json");

function ask(question: string, defaultVal: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(`${question} [${defaultVal}]: `, (answer) => {
      rl.close();
      res(answer.trim() || defaultVal);
    });
  });
}

console.log("\nAI Mirror — setup\n" + "─".repeat(30));

// 1. Ask where to store the event log
const defaultDataDir = resolve(HOME, ".skillgate/data");
const dataDir = await ask("Where should the event log be stored?", defaultDataDir);
mkdirSync(dataDir, { recursive: true });
console.log(`✓ Data directory: ${dataDir}`);

// 2. Write mirror.config.json so hook + report know where the log lives
const config = { data_dir: dataDir };
writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
console.log(`✓ Wrote mirror.config.json`);

// 3. Ensure ~/.claude exists
mkdirSync(resolve(HOME, ".claude"), { recursive: true });

// 4. Read or create settings.json
let settings: Record<string, unknown> = {};
if (existsSync(SETTINGS_PATH)) {
  try {
    settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as Record<string, unknown>;
    console.log("✓ Found existing ~/.claude/settings.json");
  } catch {
    console.log("⚠ Could not parse ~/.claude/settings.json — starting fresh");
  }
} else {
  console.log("✓ Creating ~/.claude/settings.json");
}

// 5. Inject the hook block
settings["hooks"] = {
  PostToolUse: [
    {
      matcher: "Edit|Write",
      hooks: [{ type: "command", command: HOOK_CMD }],
    },
  ],
};
writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf8");
console.log(`✓ Wired PostToolUse hook → ${HOOK_CMD}`);

// 6. Check for .env
const envPath = resolve(REPO_ROOT, ".env");
if (!existsSync(envPath)) {
  writeFileSync(envPath, "ANTHROPIC_API_KEY=\n", "utf8");
  console.log("✓ Created .env — add your ANTHROPIC_API_KEY to enable vault-grounded concept detection");
} else {
  console.log("✓ .env already exists");
}

// 7. Link the mirror CLI globally
try {
  const { execSync } = await import("child_process");
  execSync("bun link", { cwd: REPO_ROOT, stdio: "inherit" });
  console.log("✓ Linked `mirror` as a global command");
} catch {
  console.log("⚠ Could not run `bun link` — run it manually in the repo to enable the `mirror` command");
}

console.log("\nDone. Restart Claude Code for the hook to take effect.\n");
console.log("Run the weekly report anytime with:");
console.log("  mirror\n");
