import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";

const HOME = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~";
const SETTINGS_PATH = resolve(HOME, ".claude/settings.json");
const REPO_ROOT = resolve(import.meta.dir);
const HOOK_CMD = `bun run ${REPO_ROOT}/hooks/post-tool-use.ts`;

console.log("\nAI Mirror — setup\n" + "─".repeat(30));

// 1. Ensure ~/.claude exists
mkdirSync(resolve(HOME, ".claude"), { recursive: true });

// 2. Read or create settings.json
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

// 3. Inject the hook block
const hookBlock = {
  PostToolUse: [
    {
      matcher: "Edit|Write",
      hooks: [{ type: "command", command: HOOK_CMD }],
    },
  ],
};

settings["hooks"] = hookBlock;
writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf8");
console.log(`✓ Wired PostToolUse hook → ${HOOK_CMD}`);

// 4. Ensure data dir exists
mkdirSync(resolve(REPO_ROOT, "data"), { recursive: true });
console.log("✓ Created data/ directory");

// 5. Check for .env
const envPath = resolve(REPO_ROOT, ".env");
if (!existsSync(envPath)) {
  writeFileSync(envPath, "ANTHROPIC_API_KEY=\n", "utf8");
  console.log("✓ Created .env — add your ANTHROPIC_API_KEY to enable vault-grounded concept detection");
} else {
  console.log("✓ .env already exists");
}

console.log("\nDone. Restart Claude Code for the hook to take effect.\n");
console.log("Run the weekly report anytime with:");
console.log("  bun run report\n");
