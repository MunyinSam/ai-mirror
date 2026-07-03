// The witness (CONCEPTS §8): shipping code beyond your P is always allowed —
// it just gets counted. Called by the user, or by Claude after honoring an
// explicit "just give me the code" during tutor mode.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataPaths } from "../config.ts";
import { normalizePath } from "../util.ts";

export interface OverrideEvent {
  ts: string;
  concept: string;
  project: string;
  reason: string;
}

export function readOverrides(overridesPath: string): OverrideEvent[] {
  if (!existsSync(overridesPath)) return [];
  return readFileSync(overridesPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as OverrideEvent);
}

export function overrideCommand(args: string[]): void {
  const reasonIdx = args.indexOf("--reason");
  const reason = reasonIdx >= 0 ? args.slice(reasonIdx + 1).join(" ") : "";
  const concept = (reasonIdx >= 0 ? args.slice(0, reasonIdx) : args).join(" ").trim();

  if (!concept) {
    console.error('Usage: mirror override <concept> [--reason "why"]');
    process.exit(1);
  }

  const paths = dataPaths();
  const event: OverrideEvent = {
    ts: new Date().toISOString(),
    concept,
    project: normalizePath(process.cwd()),
    reason,
  };
  mkdirSync(dirname(paths.overrides), { recursive: true });
  appendFileSync(paths.overrides, JSON.stringify(event) + "\n", "utf8");

  const total = readOverrides(paths.overrides).filter((o) => o.concept === concept).length;
  console.log(`⚠ Override logged: "${concept}" (${total}× total). Earn it: /drill ${concept}`);
}
