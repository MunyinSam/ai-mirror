#!/usr/bin/env bun
// Stop hook — closes the loop the UserPromptSubmit tutor gate opens (that
// hook doesn't exist yet; this one is buildable ahead of it against a
// hand-written marker file, since the marker format is the only contract
// between them).
//
// What this does NOT do, on purpose: verify that real code was hand-typed.
// The pipeline only ever learns "human-written" as an absence — a committed
// line that doesn't match any AI event snippet, discovered by
// attributeCommit at COMMIT time (see enrich/attributeCommit.ts). There is
// no live signal at session-close time, and this session is very likely
// uncommitted. So `session` evidence records a weaker, honest claim: "a
// tutor session fired for this concept and the user didn't override it" —
// not "verified produced." That's why it's its own Evidence.type, not
// reusing 'produced'. A later pass over real commits can be the place that
// upgrades or revokes this, if that's ever built.
//
// Fails safe like the PostToolUse hook: any error here must never block the
// session from closing.
import { readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { db, closeDb } from "../db/client.ts";

const SESSION_DIR = join(homedir(), ".ai-mirror", "session");

interface HookInput {
  session_id?: string;
}

interface SessionMarker {
  gated_concepts: string[];
  flagged_at: string;
}

function readMarker(sessionId: string): SessionMarker | null {
  try {
    const raw = readFileSync(join(SESSION_DIR, `${sessionId}.json`), "utf8");
    return JSON.parse(raw) as SessionMarker;
  } catch {
    return null;
  }
}

/** ★ YOU ARE WRITING THIS. Walkthrough in chat.
 *
 *  For each concept title in `marker.gated_concepts`, write one Evidence
 *  row of type "session" into the `evidence` table, crediting the ledger
 *  entry for that concept. `ref` should be `sessionId` (so re-running this
 *  hook for the same session is idempotent via the table's
 *  UNIQUE(concept_id, type, ref) constraint — see 001_init.sql), `date`
 *  should be `now`.
 *
 *  A concept title with no matching row in `concepts` (never synced from
 *  the vault) has nothing to credit — skip it rather than erroring, since a
 *  missing concept is a vault-sync problem, not a reason to fail session
 *  close.
 */
async function writeSessionEvidence(
  sql: ReturnType<typeof db>,
  gatedConcepts: string[],
  sessionId: string,
  now: Date
): Promise<void> {
  for (const title of gatedConcepts) {
    const [concept] = await sql<{ id: number }[]>`
      SELECT id FROM concepts WHERE title = ${title}
    `;
    if (!concept) continue;

    await sql`
      INSERT INTO ledger (concept_id)
      VALUES (${concept.id})
      ON CONFLICT (concept_id) DO NOTHING
    `;

    await sql`
      INSERT INTO evidence (concept_id, type, ref, date)
      VALUES (${concept.id}, 'session', ${sessionId}, ${now.toISOString()})
      ON CONFLICT (concept_id, type, ref) DO NOTHING
    `;
  }

}

async function main(): Promise<void> {
  const raw = await Bun.stdin.text();
  const input = JSON.parse(raw) as HookInput;
  const sessionId = input.session_id;
  if (!sessionId) return;

  const marker = readMarker(sessionId);
  if (!marker) return;

  await writeSessionEvidence(db(), marker.gated_concepts, sessionId, new Date());

  rmSync(join(SESSION_DIR, `${sessionId}.json`), { force: true });
}

try {
  await main();
} catch (err) {
  console.error(`stop-hook failed: ${(err as Error).message}`);
} finally {
  await closeDb();
  process.exit(0);
}
