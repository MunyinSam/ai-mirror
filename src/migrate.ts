import type { CacheEntry, ClassifyCache, MirrorEvent } from "./types.ts";
import { langOf, normalizePath } from "./util.ts";

/** Syntax tag names the v1 classifier could emit — anything else in a v1
 *  `concepts` array was a vault title. */
const V1_TAG_NAMES = new Set([
  "async_await", "arrow_function", "decorator", "try_catch", "class",
  "interface", "type_alias", "generics", "lambda", "comprehension",
]);

interface V1Event {
  ts: string;
  author: "ai" | "you";
  tool: string;
  file: string;
  project: string;
  lines: number;
  concepts?: string[];
}

export interface MigrationResult {
  events: MirrorEvent[];
  /** cache entries preserving v1 hook-time classification results */
  cacheSeed: ClassifyCache;
  migrated: number;
}

/** Upgrade raw log rows to schema v2. v1 rows carry no code, so they get a
 *  synthetic "legacy:<n>" hash; their old concepts move into the cache under
 *  that hash, split into tags vs vault concepts. Idempotent: v2 rows pass through. */
export function migrateRows(rows: unknown[]): MigrationResult {
  const events: MirrorEvent[] = [];
  const cacheSeed: ClassifyCache = {};
  let migrated = 0;

  rows.forEach((row, i) => {
    const r = row as Partial<MirrorEvent> & V1Event;
    if (r.v === 2) {
      events.push(r as MirrorEvent);
      return;
    }
    migrated++;
    const hash = `legacy:${i}`;
    events.push({
      v: 2,
      ts: r.ts,
      author: r.author ?? "ai",
      tool: r.tool ?? "",
      file: normalizePath(r.file ?? ""),
      project: normalizePath(r.project ?? ""),
      lang: langOf(r.file ?? ""),
      lines: r.lines ?? 0,
      code_hash: hash,
      snippet: "",
    });
    const old = r.concepts ?? [];
    const entry: CacheEntry = {
      tags: old.filter((c) => V1_TAG_NAMES.has(c)),
      concepts: old.filter((c) => !V1_TAG_NAMES.has(c)),
      mapped: true, // v1 classified at hook time; there is no code to redo it with
      ts: r.ts,
    };
    cacheSeed[hash] = entry;
  });

  return { events, cacheSeed, migrated };
}
