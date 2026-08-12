// The "platform" demo surface — a thin JSON API over the same read-only
// query functions the CLI uses (buildReport in particular). Nothing here
// duplicates a query; it just serializes what report/build.ts and the
// ledger/gaps command modules already compute.
import { db } from "../db/client.ts";
import type { PeriodUnit } from "../domain/period.ts";
import { buildReport } from "../report/build.ts";

const PORT = Number(process.env["PORT"] ?? 8787);
const PERIOD_UNITS = new Set(["day", "week", "month", "year"]);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function startServer(port = PORT) {
  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/report") {
        const unitParam = url.searchParams.get("unit") ?? "week";
        const unit = (PERIOD_UNITS.has(unitParam) ? unitParam : "week") as PeriodUnit;
        const back = Number(url.searchParams.get("back") ?? "0") || 0;
        const repo = url.searchParams.get("repo") ?? undefined;
        const data = await buildReport(db(), { unit, back, repo });
        return json(data);
      }

      if (url.pathname === "/health") {
        return json({ ok: true });
      }

      return json({ error: "not found" }, 404);
    },
  });
}

if (import.meta.main) {
  const server = startServer();
  console.log(`mirror api listening on http://localhost:${server.port}`);
}
