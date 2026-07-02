import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { dataPaths } from "../config.ts";
import { migrateRows } from "../migrate.ts";
import type { ClassifyCache } from "../types.ts";

export function migrateCommand(): void {
  const paths = dataPaths();
  if (!existsSync(paths.events)) {
    console.log("No event log found — nothing to migrate.");
    return;
  }

  const rows = readFileSync(paths.events, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as unknown);

  const { events, cacheSeed, migrated } = migrateRows(rows);
  if (migrated === 0) {
    console.log(`All ${rows.length} events already at schema v2 — nothing to do.`);
    return;
  }

  mkdirSync(paths.archiveDir, { recursive: true });
  const backup = resolve(paths.archiveDir, `events-v1-${Date.now()}.jsonl`);
  renameSync(paths.events, backup);
  writeFileSync(paths.events, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");

  const cache: ClassifyCache = existsSync(paths.cache)
    ? (JSON.parse(readFileSync(paths.cache, "utf8")) as ClassifyCache)
    : {};
  Object.assign(cache, cacheSeed);
  writeFileSync(paths.cache, JSON.stringify(cache, null, 2), "utf8");

  console.log(`✓ Migrated ${migrated} v1 event(s) to schema v2 (${events.length} total).`);
  console.log(`✓ Backup: ${backup}`);
  console.log(`✓ Seeded classify cache with ${Object.keys(cacheSeed).length} legacy entries.`);
}
