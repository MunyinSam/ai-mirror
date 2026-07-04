import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as readline from "node:readline";
import { c } from "../colors.ts";
import { CONFIG_FILE, REPO_ROOT } from "../config.ts";

const HOME = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~";
const SETTINGS_PATH = resolve(HOME, ".claude/settings.json");
const HOOK_CMD = `bun run ${REPO_ROOT}/src/hook.ts`;
const PROMPT_HOOK_CMD = `bun run ${REPO_ROOT}/src/prompt-hook.ts`;

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

const TOTAL_STEPS = 7;
/** Numbered section header — everything under it is indented two spaces. */
function step(n: number, title: string): void {
  console.log(c.bold(`\n[${n}/${TOTAL_STEPS}] `) + title);
}

const CONCEPT_TEMPLATE = `---
title:
aliases: []
type: concept
parent:
domain:
status: draft
confidence: learning
---

# {{title}}

<!-- One-sentence definition. -->

<!-- Body. -->
`;

const ROOT_MOC = `---
title: Concepts
aliases: []
type: moc
parent:
domain:
---

# Concepts

Root index of all concept domains. Add a wikilink here when registering a new top-level domain MOC.

<!-- Domains are created on demand as concepts get filed (see /gaps, /drill,
     /add-new-concepts). This vault was scaffolded by \`mirror setup\` — a
     minimal starting point, not a replacement for the full /init-vault skill. -->
`;

/** Minimal, non-interactive vault scaffold: just enough structure for the
 *  mirror + companion skills to read/write concept notes. The fuller
 *  /init-vault skill (research/projects/reviews/_claude spec) can layer on
 *  top later — this never conflicts with it, same vault-config.json shape. */
function scaffoldMinimalVault(vaultDir: string): void {
  mkdirSync(resolve(vaultDir, "concepts"), { recursive: true });
  mkdirSync(resolve(vaultDir, "templates"), { recursive: true });
  const conceptTemplatePath = resolve(vaultDir, "templates/concept.md");
  if (!existsSync(conceptTemplatePath)) {
    writeFileSync(conceptTemplatePath, CONCEPT_TEMPLATE, "utf8");
  }
  const mocPath = resolve(vaultDir, "concepts/_moc.md");
  if (!existsSync(mocPath)) {
    writeFileSync(mocPath, ROOT_MOC, "utf8");
  }
}

/** Best-effort path of the user's most recently open Obsidian vault, read
 *  from Obsidian's own registry — so the minimal scaffold can land somewhere
 *  they already look. Any failure → null, caller keeps its default. */
function detectObsidianVault(): string | null {
  const appData = process.env["APPDATA"];
  const candidates = [
    ...(appData ? [resolve(appData, "obsidian/obsidian.json")] : []),
    resolve(HOME, "Library/Application Support/obsidian/obsidian.json"),
    resolve(HOME, ".config/obsidian/obsidian.json"),
  ];
  for (const file of candidates) {
    try {
      if (!existsSync(file)) continue;
      const { vaults } = JSON.parse(readFileSync(file, "utf8")) as {
        vaults?: Record<string, { path?: string; ts?: number; open?: boolean }>;
      };
      const list = Object.values(vaults ?? {}).filter((v) => v.path && existsSync(v.path));
      if (list.length === 0) continue;
      list.sort((a, b) => Number(b.open ?? false) - Number(a.open ?? false) || (b.ts ?? 0) - (a.ts ?? 0));
      return list[0]!.path!;
    } catch {
      // unreadable registry — try the next location
    }
  }
  return null;
}

interface HookEntry {
  matcher?: string;
  hooks?: { type: string; command: string }[];
}

/** Replace our entry for one hook event without clobbering any other hooks
 *  the user has configured. Ours is identified by the repo path in the command. */
export function mergeHookSettings(
  settings: Record<string, unknown>,
  event: string,
  hookCmd: string,
  matcher?: string
): Record<string, unknown> {
  const hooks = (settings["hooks"] ?? {}) as Record<string, unknown>;
  const existing = Array.isArray(hooks[event]) ? (hooks[event] as HookEntry[]) : [];
  const others = existing.filter(
    (e) => !(e.hooks ?? []).some((h) => h.command.includes("ai-mirror"))
  );
  hooks[event] = [
    ...others,
    { ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: hookCmd }] },
  ];
  settings["hooks"] = hooks;
  return settings;
}

export async function setupCommand(): Promise<void> {
  console.log(c.bold(c.cyan("\nAI Mirror — setup")));

  // 1. Data directory — merged into any existing config so re-running setup
  // never wipes `projects` (or future keys) from mirror.config.json.
  step(1, "Data directory");
  let existingConfig: Record<string, unknown> = {};
  if (existsSync(CONFIG_FILE)) {
    try {
      existingConfig = JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Record<string, unknown>;
    } catch {
      console.log("  ⚠ Could not parse mirror.config.json — rebuilding it");
    }
  }
  const defaultDataDir =
    typeof existingConfig["data_dir"] === "string"
      ? (existingConfig["data_dir"] as string)
      : resolve(HOME, ".skillgate/data");
  const dataDir = await ask("  Where should the event log be stored?", defaultDataDir);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify({ ...existingConfig, data_dir: dataDir }, null, 2), "utf8");
  console.log(`  ✓ ${dataDir}`);

  // 2. Wire the hook into ~/.claude/settings.json (idempotent, preserves other hooks)
  step(2, "Claude Code hooks (~/.claude/settings.json)");
  mkdirSync(resolve(HOME, ".claude"), { recursive: true });
  let settings: Record<string, unknown> = {};
  if (existsSync(SETTINGS_PATH)) {
    try {
      settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as Record<string, unknown>;
    } catch {
      console.log("  ⚠ Could not parse ~/.claude/settings.json — starting fresh");
    }
  }
  settings = mergeHookSettings(settings, "PostToolUse", HOOK_CMD, "Edit|Write");
  settings = mergeHookSettings(settings, "UserPromptSubmit", PROMPT_HOOK_CMD);
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf8");
  console.log(`  ✓ PostToolUse capture ${c.dim("— logs every AI edit, locally")}`);
  console.log(`  ✓ UserPromptSubmit tutor ${c.dim("— skill-aware prompt injection")}`);

  // 3. API key for the report-time classifier (the hook itself never needs
  // one). Only ever fills an empty slot — a non-empty key is never touched.
  step(3, `API key ${c.dim("— unlocks concept mapping + style distillation")}`);
  const envPath = resolve(REPO_ROOT, ".env");
  const envText = existsSync(envPath) ? readFileSync(envPath, "utf8") : null;
  const keyLine = envText
    ?.split("\n")
    .find((l) => l.trimStart().startsWith("ANTHROPIC_API_KEY="));
  const hasKey = !!keyLine && keyLine.slice(keyLine.indexOf("=") + 1).trim().length > 0;
  if (hasKey) {
    console.log("  ✓ .env already has an ANTHROPIC_API_KEY");
  } else {
    const key = await ask("  Anthropic API key (Enter to skip)", "");
    if (envText === null) {
      writeFileSync(envPath, `ANTHROPIC_API_KEY=${key}\n`, "utf8");
    } else if (keyLine) {
      writeFileSync(envPath, envText.replace(keyLine, `ANTHROPIC_API_KEY=${key}`), "utf8");
    } else {
      writeFileSync(envPath, `${envText.trimEnd()}\nANTHROPIC_API_KEY=${key}\n`, "utf8");
    }
    console.log(
      key
        ? "  ✓ Saved to .env"
        : `  · Skipped ${c.dim("— capture still works; add the key to .env anytime")}`
    );
  }

  // 4. Vault — the mirror can't track concepts without one
  step(4, `Vault ${c.dim("— the concept namespace the mirror tracks skill against")}`);
  const VAULT_CONFIG_PATH = resolve(HOME, ".claude/vault-config.json");
  if (existsSync(VAULT_CONFIG_PATH)) {
    try {
      const { vault_path } = JSON.parse(readFileSync(VAULT_CONFIG_PATH, "utf8")) as {
        vault_path: string;
      };
      console.log(`  ✓ ${vault_path}`);
    } catch {
      console.log("  ⚠ ~/.claude/vault-config.json exists but couldn't be parsed — leaving it alone");
    }
  } else {
    console.log(c.dim("  Without one, AI edits are logged but can't map to concepts,"));
    console.log(c.dim("  build a skill ledger, or power /gaps, /drill, /mirror-week."));
    const makeVault = await ask("  Create a minimal vault now? (y/n)", "y");
    if (makeVault.toLowerCase().startsWith("y")) {
      const detected = detectObsidianVault();
      const defaultVaultDir = detected ?? resolve(HOME, ".skillgate/vault");
      const vaultDir = await ask("  Where should the vault live?", defaultVaultDir);
      scaffoldMinimalVault(vaultDir);
      writeFileSync(
        VAULT_CONFIG_PATH,
        JSON.stringify({ vault_path: vaultDir, initialized_at: new Date().toISOString().slice(0, 10) }, null, 2),
        "utf8"
      );
      console.log(`  ✓ Scaffolded at ${vaultDir}`);
      if (!detected || resolve(vaultDir) !== resolve(detected)) {
        console.log(c.dim(`    Open it in Obsidian ("Open folder as vault") — notes filed by`));
        console.log(c.dim(`    /drill and /add-new-concepts land in ${resolve(vaultDir, "concepts")}.`));
      }
    } else {
      console.log("  · Skipped — run the /init-vault skill later, or re-run `mirror setup`.");
    }
  }

  // 5. Companion skills (/gaps, /drill, /mirror-week)
  // Bundled files use {{MIRROR_REPO}} / {{STYLE_GUIDE}} placeholders so each
  // machine's install points at its own clone — never a synced foreign path.
  const substitute = (text: string): string =>
    text
      .replaceAll("{{MIRROR_REPO}}", REPO_ROOT.replace(/\\/g, "/"))
      .replaceAll("{{STYLE_GUIDE}}", resolve(dataDir, "style/style-guide.md").replace(/\\/g, "/"));

  step(5, `Companion skills ${c.dim("— /gaps triage · /drill learn+earn · /mirror-week ritual")}`);
  const installSkills = await ask("  Install them? (y/n)", "y");
  if (installSkills.toLowerCase().startsWith("y")) {
    const skillsSrc = resolve(REPO_ROOT, "skills");
    const skillsDst = resolve(HOME, ".claude/skills");
    const installed: string[] = [];
    for (const name of ["gaps", "drill", "mirror-week"]) {
      const src = resolve(skillsSrc, name, "SKILL.md");
      if (!existsSync(src)) continue;
      mkdirSync(resolve(skillsDst, name), { recursive: true });
      writeFileSync(resolve(skillsDst, name, "SKILL.md"), substitute(readFileSync(src, "utf8")), "utf8");
      installed.push(`/${name}`);
    }
    console.log(`  ✓ ${installed.join(" · ")}`);
  } else {
    console.log("  · Skipped");
  }

  // 6. Commit-time gate — the one net that catches AI code from ANY source
  // (Copilot, browser paste), because everything funnels through `git commit`.
  step(6, `Commit-time gate ${c.dim("— a short skill advisory at every commit, never blocks")}`);
  const gateAnswer = await ask("  Install into a repo? (repo path / n)", "n");
  if (/^no?$/i.test(gateAnswer)) {
    console.log("  · Skipped — `mirror gate install <repo>` works anytime");
  } else {
    const { gateInstall } = await import("./gate.ts");
    if (!gateInstall(gateAnswer)) {
      console.log("  ⚠ Not installed — `mirror gate install <repo>` works anytime");
    }
  }

  // 7. Observe-only policy block in the global CLAUDE.md. Idempotent by
  // marker, but REPLACES an existing section — a synced CLAUDE.md from
  // another machine carries that machine's paths and must be refreshed.
  step(7, `CLAUDE.md policy ${c.dim("— tutor-first, never refuse")}`);
  const addPolicy = await ask("  Add it to ~/.claude/CLAUDE.md? (y/n)", "y");
  if (addPolicy.toLowerCase().startsWith("y")) {
    const policyPath = resolve(REPO_ROOT, "skills/claude-md-policy.md");
    const claudeMdPath = resolve(HOME, ".claude/CLAUDE.md");
    const existing = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, "utf8") : "";
    const policy = substitute(readFileSync(policyPath, "utf8")).trimEnd();
    const marker = "# AI Mirror policy";
    if (existing.includes(marker)) {
      // Replace from the marker heading to the next top-level heading (or EOF).
      const start = existing.indexOf(marker);
      const rest = existing.slice(start + marker.length);
      const nextHeading = rest.search(/^# /m);
      const end = nextHeading === -1 ? existing.length : start + marker.length + nextHeading;
      const updated = existing.slice(0, start) + policy + "\n\n" + existing.slice(end);
      writeFileSync(claudeMdPath, updated.replace(/\n{3,}/g, "\n\n"), "utf8");
      console.log(`  ✓ Refreshed ${c.dim("(machine paths updated)")}`);
    } else {
      writeFileSync(claudeMdPath, existing ? `${existing.trimEnd()}\n\n${policy}\n` : `${policy}\n`, "utf8");
      console.log("  ✓ Appended");
    }
  }

  closePrompts();

  // Global `mirror` command. Output is swallowed — bun link's "add it as a
  // dependency" hint doesn't apply here; only the bin registration matters.
  try {
    const { execSync } = await import("node:child_process");
    execSync("bun link", { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    console.log("\n✓ `mirror` linked as a global command");
  } catch {
    console.log("\n⚠ Could not run `bun link` — run it manually in the repo");
  }

  console.log(c.bold("\nDone — restart Claude Code for the hooks and skills to load."));
  console.log(`  mirror        ${c.dim("the weekly report")}`);
  console.log(`  mirror gaps   ${c.dim("what to learn next")}\n`);
}
