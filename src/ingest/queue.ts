// Claiming a queue file safely — the mechanical half of ingest.
//
// Why rename() and not just open-and-read: the capture hook is still
// appendFileSync-ing to today's file while you might be draining yesterday's.
// rename() on the same filesystem is atomic — the OS guarantees no reader
// ever sees a half-renamed file. Once claimed as `<name>.draining`, the hook
// (which only ever opens `<today>.jsonl`) can never write into it again, so
// it's now safe to read start-to-finish with no lock.
import { readdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const QUEUE_DIR = join(process.env["HOME"] ?? "", ".ai-mirror", "queue");

/** Every *.jsonl queue file not already claimed by another drain run. */
export function listQueueFiles(dir = QUEUE_DIR): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(dir, f));
  } catch {
    return []; // queue dir doesn't exist yet — nothing captured, nothing to drain
  }
}

/** Atomically claim a queue file for draining. Returns the claimed path, or
 *  null if it vanished between listing and claiming (another drain run got
 *  there first, or it was already fully drained). */
export function claimQueueFile(path: string): string | null {
  const claimed = `${path}.draining`;
  try {
    renameSync(path, claimed);
    return claimed;
  } catch {
    return null;
  }
}

/** Delete a fully-drained (and only fully-drained) claimed file. */
export function ackQueueFile(claimedPath: string): void {
  unlinkSync(claimedPath);
}
