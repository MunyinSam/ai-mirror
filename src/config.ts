import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "..");

const CONFIG_PATH = resolve(REPO_ROOT, "mirror.config.json");

export interface MirrorConfig {
  data_dir: string;
}

export function loadConfig(): MirrorConfig {
  if (existsSync(CONFIG_PATH)) {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as MirrorConfig;
  }
  return { data_dir: resolve(REPO_ROOT, "data") };
}

export function dataPaths(config = loadConfig()) {
  const d = config.data_dir;
  return {
    dataDir: d,
    events: resolve(d, "events.jsonl"),
    cache: resolve(d, "classify-cache.json"),
    skills: resolve(d, "skills.json"),
    styleDir: resolve(d, "style"),
    styleSamples: resolve(d, "style", "samples.jsonl"),
    styleProfile: resolve(d, "style", "profile.json"),
    styleGuide: resolve(d, "style", "style-guide.md"),
    archiveDir: resolve(d, "archive"),
  };
}

export const CONFIG_FILE = CONFIG_PATH;

/** Load .env from the repo root into process.env (existing vars win).
 *  Only the CLI calls this — the hook never needs a key. */
export function loadEnv(): void {
  const envPath = resolve(REPO_ROOT, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq <= 0 || line.trimStart().startsWith("#")) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key && val && process.env[key] === undefined) process.env[key] = val;
  }
}
