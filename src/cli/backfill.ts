#!/usr/bin/env bun
// Stage 5 — run the whole pipeline over real history:
//   1. drain whatever's sitting in the live queue (new-format events)
//   2. import the two stranded legacy sources (old Prod hook + old v1 data dir)
//   3. discover commits for every repo that has AI events
//   4. attribute every pending commit
//   5. print the real number
//
// Every step here is a call to something already built and unit-tested —
// this file is composition, not new logic. Safe to re-run: draining,
// importing, and attributing are all idempotent.
//
// YOU ARE WRITING each function below. Walkthroughs in chat, one at a time.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Sql } from "../db/client.ts";
import { closeDb, db } from "../db/client.ts";
import { attributeCommit } from "../enrich/attributeCommit.ts";
import { importLegacyFile } from "../enrich/legacyImport.ts";
import { listCommitsSince } from "../git/diff.ts";
import { drainQueueFile } from "../ingest/drain.ts";
import { claimQueueFile, listQueueFiles, QUEUE_DIR } from "../ingest/queue.ts";
import { isExcludedRepo } from "../types.ts";

const LEGACY_SOURCES = [
  join(homedir(), ".ai-mirror", "queue.jsonl"), // the orphaned Prod hook's queue
  join(homedir(), ".skillgate", "data", "events.jsonl"), // the original v1 data dir
];

/** Claim and drain every file sitting in the live queue dir.*/
async function drainLiveQueue(sql: Sql): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const path of listQueueFiles(QUEUE_DIR)) {
    const claimed = claimQueueFile(path);
    if (!claimed) continue;
    const r = await drainQueueFile(sql, claimed || '')
    inserted += r.inserted;
    skipped += r.skipped;
  }
  return { inserted, skipped }
}

/** Import both legacy sources.*/
async function importLegacySources(sql: Sql): Promise<void> {
  for (const path of LEGACY_SOURCES) {
    const r = await importLegacyFile(sql, path);
    console.log(`  ${path}: +${r.inserted} (${r.skipped} already present)`);
  }
  return
}

/** For every repo that has AI events, walk its commit history since the
 *  earliest event and insert new rows into `commits`. */
async function discoverCommits(sql: Sql): Promise<number> {

  const repos = await sql<{ repo: string; earliest: string }[]>`
    SELECT repo, min(ts) AS earliest FROM events GROUP BY repo
  `

  let discovered = 0;
  for (const { repo, earliest } of repos) {
    if (isExcludedRepo(repo)) {
      console.log(`  skip ${repo} (system/package-manager dir, not a project)`);
      continue;
    }
    if (!existsSync(repo)) {
      console.log(`  skip ${repo} (no longer on disk)`);
      continue;
    }
    const commits = listCommitsSince(repo, earliest);
    if (commits.length === 0) continue;

    const rows = commits.map((c) => ({
      repo,
      sha: c.sha,
      ts: c.ts,
      author_email: c.authorEmail,
      subject: c.subject,
    }));
    const result = await sql `
      INSERT INTO commits ${sql(rows)}
      ON CONFLICT (repo, sha) DO NOTHING
    `;
    console.log(`  ${repo}: ${result.count} new commits (of ${commits.length} seen)`);
    discovered += result.count;
  }
  return discovered;
}

/** Run attributeCommit over every commit still missing attributed_at. */
async function attributePending(
  sql: Sql
): Promise<{ attributed: number; failed: number; total: number }> {
  const pending = await sql<{ repo: string; sha: string}[]>`
    SELECT repo, sha FROM commits WHERE attributed_at IS NULL ORDER BY ts ASC
  `;

  let attributed = 0;
  let failed = 0;
  for (const { repo, sha } of pending) {
    try {
      await attributeCommit(sql, repo, sha);
      attributed++;
    } catch (err) {
      failed++;
      console.log(`  failed ${repo}@${sha.slice(0, 8)}: ${(err as Error).message}`);
    }
  }
  return { attributed, failed, total: pending.length };
}

async function printSummary(sql: Sql) {
  const [totals] = await sql<{ added: number; ai: number }[]>`
    SELECT coalesce(sum(added_lines), 0)::int AS added,
           coalesce(sum(ai_lines), 0)::int AS ai
    FROM attributions
  `;
  const added = totals?.added ?? 0;
  const ai = totals?.ai ?? 0;
  const pct = added === 0 ? 0 : Math.round((ai / added) * 100);
  console.log(`\n${added} lines attributed across all history: ${pct}% AI, ${100 - pct}% you.`);
}

async function backfill() {
  const sql = db();

  console.log("1. draining live queue...");
  const live = await drainLiveQueue(sql);
  console.log(`   +${live.inserted} (${live.skipped} already present)\n`);

  console.log("2. importing legacy sources...");
  await importLegacySources(sql);
  console.log();

  console.log("3. discovering commits...");
  const discovered = await discoverCommits(sql);
  console.log(`   ${discovered} new commits\n`);

  console.log("4. attributing pending commits...");
  const result = await attributePending(sql);
  console.log(`   ${result.attributed}/${result.total} attributed (${result.failed} failed)\n`);

  await printSummary(sql);
}

if (import.meta.main) {
  await backfill();
  await closeDb();
}
