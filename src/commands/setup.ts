import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as readline from "node:readline";
import { CONFIG_FILE, REPO_ROOT } from "../config.ts";

const HOME = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~";
const SETTINGS_PATH = resolve(HOME, ".claude/settings.json");
const HOOK_CMD = `bun run ${REPO_ROOT}/src/hook.ts`;

// One shared interface — a fresh one per question drops buffered piped input,
// and a closed stdin (Ctrl+D / piped defaults) must resolve with the default,
// not hang or throw on the next question.
let rl: readline.Interface | null = null;
let stdinClosed = false;

function ask(question: string, defaultVal: string): Promise<string> {
  if (stdinClosed) {
    console.log(`${question} [${defaultVal}]: (default)`);
    return Promise.resolve(defaultVal);
  }
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.once("close", () => {
      stdinClosed = true;
    });
  }
  return new Promise((res) => {
    let answered = false;
    const done = (answer: string) => {
      if (answered) return;
      answered = true;
      res(answer.trim() || defaultVal);
    };
    rl!.question(`${question} [${defaultVal}]: `, done);
    rl!.once("close", () => done(""));
  });
}

function closePrompts(): void {
  rl?.close();
  rl = null;
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

  // 4. Companion skills (/gaps, /drill, /mirror-week)
  const installSkills = await ask(
    "Install the companion skills (/gaps, /drill, /mirror-week)? (y/n)",
    "y"
  );
  if (installSkills.toLowerCase().startsWith("y")) {
    const skillsSrc = resolve(REPO_ROOT, "skills");
    const skillsDst = resolve(HOME, ".claude/skills");
    for (const name of ["gaps", "drill", "mirror-week"]) {
      const src = resolve(skillsSrc, name, "SKILL.md");
      if (!existsSync(src)) continue;
      mkdirSync(resolve(skillsDst, name), { recursive: true });
      writeFileSync(resolve(skillsDst, name, "SKILL.md"), readFileSync(src, "utf8"), "utf8");
      console.log(`✓ Installed skill: /${name}`);
    }
  }

  // 5. Observe-only policy block in the global CLAUDE.md (idempotent by marker)
  const addPolicy = await ask(
    "Add the observe-only AI Mirror policy to ~/.claude/CLAUDE.md? (y/n)",
    "y"
  );
  if (addPolicy.toLowerCase().startsWith("y")) {
    const policyPath = resolve(REPO_ROOT, "skills/claude-md-policy.md");
    const claudeMdPath = resolve(HOME, ".claude/CLAUDE.md");
    const existing = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, "utf8") : "";
    if (existing.includes("# AI Mirror policy")) {
      console.log("✓ CLAUDE.md already has the AI Mirror policy — left as is");
    } else {
      const policy = readFileSync(policyPath, "utf8");
      writeFileSync(claudeMdPath, existing ? `${existing.trimEnd()}\n\n${policy}` : policy, "utf8");
      console.log("✓ Appended AI Mirror policy to ~/.claude/CLAUDE.md");
    }
  }

  closePrompts();

  // 6. Global `mirror` command
  try {
    const { execSync } = await import("node:child_process");
    execSync("bun link", { cwd: REPO_ROOT, stdio: "inherit" });
    console.log("✓ Linked `mirror` as a global command");
  } catch {
    console.log("⚠ Could not run `bun link` — run it manually in the repo");
  }

  console.log("\nDone. Restart Claude Code for the hook and skills to take effect.");
  console.log("Run `mirror` anytime for the weekly report, `mirror gaps` to see what to learn.\n");
}
