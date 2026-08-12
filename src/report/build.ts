// Assembles report data from what's already in Postgres. Deliberately never
// triggers classification itself (see `mirror classify`) — viewing a report
// should never silently spend API money; classifying is its own explicit
// step, same split as attribute.ts (pure) vs attributeCommit.ts (I/O).
import type { Sql } from "../db/client.ts";
import { periodRange, type Period, type PeriodUnit } from "../domain/period.ts";
import { bucketOf, daysUntilDecay, type SkillBucket } from "../domain/skill.ts";
import type { LedgerEntry } from "../types.ts";
import { normalizePath } from "../util.ts";

export interface ReportOptions {
  unit: PeriodUnit;
  back: number;
  repo?: string;
}

export interface ConceptUsage {
  concept: string;
  uses: number;
  bucket: SkillBucket;
}

export interface RepoActivity {
  repo: string;
  commits: number;
  files: number;
}

export interface TrendPoint {
  start: string;
  ai_pct: number;
  beyond: number;
}

export interface ReportData {
  period: { unit: PeriodUnit; start: string; end: string };
  repo: string | null;
  lines: { ai: number; human: number; ai_pct: number };
  concepts: ConceptUsage[];
  unfiled: { concept: string; uses: number }[];
  repos: RepoActivity[];
  trend: TrendPoint[];
  decay_alerts: { concept: string; days: number }[];
}

/** Every ledger entry, keyed by concept title — the "one implementation"
 *  from domain/skill.ts needs this shape (LedgerEntry), not raw rows. */
async function loadLedgerByTitle(sql: Sql): Promise<Map<string, LedgerEntry>> {
  const rows = await sql<
    {
      title: string;
      understanding: number;
      coding_level: number;
      last_produced: string | null;
      decay_u_days: number;
      decay_p_days: number;
    }[]
  >`
    SELECT c.title, l.understanding, l.coding_level, l.last_produced,
           l.decay_u_days, l.decay_p_days
    FROM ledger l JOIN concepts c ON c.id = l.concept_id
  `;
  const evidenceRows = await sql<
    { title: string; type: "produced" | "claimed"; ref: string; date: string }[]
  >`
    SELECT c.title, e.type, e.ref, e.date
    FROM evidence e
    JOIN ledger l ON l.concept_id = e.concept_id
    JOIN concepts c ON c.id = l.concept_id
  `;
  const evidenceByTitle = new Map<string, LedgerEntry["evidence"]>();
  for (const e of evidenceRows) {
    const list = evidenceByTitle.get(e.title) ?? [];
    list.push({ type: e.type, ref: e.ref, date: e.date });
    evidenceByTitle.set(e.title, list);
  }
  return new Map(
    rows.map((r) => [
      r.title,
      {
        concept: r.title,
        understanding: r.understanding,
        coding_level: r.coding_level,
        last_produced: r.last_produced,
        decay_days: { u: r.decay_u_days, p: r.decay_p_days },
        evidence: evidenceByTitle.get(r.title) ?? [],
      },
    ])
  );
}

async function lineTotals(
  sql: Sql,
  period: Period,
  repo?: string
): Promise<{ ai: number; human: number }> {
  const rows = await sql<{ ai: number | null; human: number | null }[]>`
    SELECT sum(a.ai_lines)::int AS ai, sum(a.human_lines)::int AS human
    FROM attributions a JOIN commits c ON c.id = a.commit_id
    WHERE c.ts BETWEEN ${period.start.toISOString()} AND ${period.end.toISOString()}
      AND (${repo ?? null}::text IS NULL OR c.repo = ${repo ?? null})
  `;
  return { ai: rows[0]?.ai ?? 0, human: rows[0]?.human ?? 0 };
}

/** Concept titles the AI's code touched in `period`, with usage counts —
 *  read from classify_cache via the events that were live in that window. */
async function conceptUsage(sql: Sql, period: Period, repo?: string): Promise<Map<string, number>> {
  const rows = await sql<{ concept: string; uses: number }[]>`
    SELECT unnest(cc.concepts) AS concept, count(*)::int AS uses
    FROM events e JOIN classify_cache cc ON cc.code_hash = e.code_hash
    WHERE e.ts BETWEEN ${period.start.toISOString()} AND ${period.end.toISOString()}
      AND (${repo ?? null}::text IS NULL OR e.repo = ${repo ?? null})
    GROUP BY 1
  `;
  return new Map(rows.map((r) => [r.concept, r.uses]));
}

async function unfiledUsage(sql: Sql, period: Period, repo?: string): Promise<Map<string, number>> {
  const rows = await sql<{ concept: string; uses: number }[]>`
    SELECT unnest(cc.suggested) AS concept, count(*)::int AS uses
    FROM events e JOIN classify_cache cc ON cc.code_hash = e.code_hash
    WHERE e.ts BETWEEN ${period.start.toISOString()} AND ${period.end.toISOString()}
      AND (${repo ?? null}::text IS NULL OR e.repo = ${repo ?? null})
    GROUP BY 1
  `;
  return new Map(rows.map((r) => [r.concept, r.uses]));
}

async function repoActivity(sql: Sql, period: Period, repo?: string): Promise<RepoActivity[]> {
  const rows = await sql<{ repo: string; commits: number; files: number }[]>`
    SELECT c.repo, count(DISTINCT c.id)::int AS commits, count(DISTINCT a.file)::int AS files
    FROM commits c JOIN attributions a ON a.commit_id = c.id
    WHERE c.ts BETWEEN ${period.start.toISOString()} AND ${period.end.toISOString()}
      AND (${repo ?? null}::text IS NULL OR c.repo = ${repo ?? null})
    GROUP BY c.repo ORDER BY commits DESC
  `;
  return rows;
}

function aiPct(ai: number, human: number): number {
  const total = ai + human;
  return total === 0 ? 0 : Math.round((ai / total) * 100);
}

export async function buildReport(sql: Sql, opts: ReportOptions): Promise<ReportData> {
  const repo = opts.repo ? normalizePath(opts.repo) : undefined;
  const period = periodRange(opts.unit, opts.back);
  const ledger = await loadLedgerByTitle(sql);

  const [lines, usage, unfiled, repos] = await Promise.all([
    lineTotals(sql, period, repo),
    conceptUsage(sql, period, repo),
    unfiledUsage(sql, period, repo),
    repoActivity(sql, period, repo),
  ]);

  const concepts: ConceptUsage[] = [...usage.entries()]
    .map(([concept, uses]) => ({ concept, uses, bucket: bucketOf(ledger.get(concept)) }))
    .sort((a, b) => b.uses - a.uses);

  const trend: TrendPoint[] = [];
  for (let n = 3; n >= 0; n--) {
    const p = periodRange(opts.unit, opts.back + n);
    const [t, u] = await Promise.all([lineTotals(sql, p, repo), conceptUsage(sql, p, repo)]);
    const beyond = [...u.keys()].filter((c) => bucketOf(ledger.get(c)) === "beyond").length;
    trend.push({ start: p.start.toISOString().slice(0, 10), ai_pct: aiPct(t.ai, t.human), beyond });
  }

  const decayAlerts = [...ledger.values()]
    .map((entry) => ({ concept: entry.concept, days: daysUntilDecay(entry) }))
    .filter((a): a is { concept: string; days: number } => a.days !== null && a.days <= 7)
    .sort((a, b) => a.days - b.days);

  return {
    period: {
      unit: opts.unit,
      start: period.start.toISOString().slice(0, 10),
      end: period.end.toISOString().slice(0, 10),
    },
    repo: repo ?? null,
    lines: { ai: lines.ai, human: lines.human, ai_pct: aiPct(lines.ai, lines.human) },
    concepts,
    unfiled: [...unfiled.entries()]
      .map(([concept, uses]) => ({ concept, uses }))
      .sort((a, b) => b.uses - a.uses),
    repos,
    trend,
    decay_alerts: decayAlerts,
  };
}
