#!/usr/bin/env bun
// Forward-only migration runner.
//
// The whole idea: a `schema_migrations` table records which files have been
// applied, so running this is idempotent and safe on every boot. Each file
// runs inside a transaction — a migration either lands completely or not at
// all, so there is no such thing as a half-migrated database.
//
// Forward-only (no `down`) is a deliberate choice: rollback scripts are
// written when you are calm and executed when you are panicking, and they are
// almost always wrong. Fix forward with a new numbered file instead.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { closeDb, db } from "./client.ts";

const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

export async function migrate(): Promise<string[]> {
  const sql = db();

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name)
  );

  // Lexicographic sort is why files are numbered 001_, 002_ — zero-padding
  // keeps 010 after 009 instead of after 001.
  const pending = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => !applied.has(f));

  for (const name of pending) {
    const body = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations ${tx({ name })}`;
    });
    console.log(`  applied ${name}`);
  }

  return pending;
}

if (import.meta.main) {
  const pending = await migrate();
  console.log(pending.length === 0 ? "up to date, nothing to apply" : `${pending.length} applied`);
  await closeDb();
}
