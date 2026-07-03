// Shared hand-written-code sync: git commits minus AI snippets → P evidence +
// style samples. Used by `mirror ledger sync` (verbose) and auto-run by
// `mirror report` (quiet) so committed hand-written work is credited without
// the user remembering a manual step.
import { dataPaths } from "./config.ts";
import { classifyAll, type ClassifyInput } from "./classifier.ts";
import { eventsByProject, inferHandwritten } from "./handwritten.ts";
import { addProducedEvidence, loadLedger, saveLedger, syncUnderstanding } from "./ledger.ts";
import { readEvents } from "./log.ts";
import { appendSamples } from "./style.ts";
import type { StyleSample } from "./types.ts";
import { langOf, sha256 } from "./util.ts";
import { loadVaultConcepts } from "./vault.ts";

export interface SyncResult {
  evidence: number;
  samples: number;
  reposScanned: number;
  log: string[]; // per-repo messages, printed only by the verbose caller
}

export async function syncHandwritten(days: number, onlyRepo?: string): Promise<SyncResult> {
  const paths = dataPaths();
  const events = readEvents(paths.events);
  const vault = loadVaultConcepts();
  const ledger = loadLedger(paths.skills);
  syncUnderstanding(ledger, vault);

  const projects = eventsByProject(events);
  if (onlyRepo && !projects.has(onlyRepo)) projects.set(onlyRepo, []);

  const result: SyncResult = { evidence: 0, samples: 0, reposScanned: 0, log: [] };

  for (const [repo, projectEvents] of projects) {
    if (onlyRepo && repo !== onlyRepo) continue;
    result.reposScanned++;
    const hunks = inferHandwritten(repo, days, projectEvents);
    if (hunks.length === 0) continue;

    const inputs: ClassifyInput[] = hunks.map((h) => ({
      code_hash: sha256(h.lines.join("\n")),
      snippet: h.lines.join("\n"),
      lang: langOf(h.file),
    }));
    const { cache } = await classifyAll(paths.cache, inputs, vault.map((v) => v.title));

    const samples: StyleSample[] = [];
    hunks.forEach((hunk, i) => {
      const input = inputs[i]!;
      const concepts = cache[input.code_hash]?.concepts ?? [];
      for (const concept of concepts) {
        const ref = `commit:${hunk.commit.slice(0, 7)}`;
        if (addProducedEvidence(ledger, concept, ref, hunk.date)) result.evidence++;
      }
      samples.push({
        ts: hunk.date,
        project: repo,
        file: hunk.file,
        lang: input.lang,
        code: input.snippet,
        concepts,
        commit: hunk.commit.slice(0, 7),
        hash: input.code_hash,
      });
    });

    result.samples += appendSamples(paths.styleSamples, samples);
    result.log.push(`✓ ${repo}: ${hunks.length} hand-written hunk(s) found`);
  }

  saveLedger(paths.skills, ledger);
  return result;
}
