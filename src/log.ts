import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { MirrorEvent } from "./types.ts";

export function readEvents(logPath: string): MirrorEvent[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as MirrorEvent);
}

export function appendEvent(logPath: string, event: MirrorEvent): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, JSON.stringify(event) + "\n", "utf8");
}
