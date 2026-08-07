// The single Postgres handle. Nothing else in the codebase constructs one.
//
// Note what is NOT here: the capture hook never imports this file. The write
// path must not depend on a database being up — see src/capture/hook.ts.
import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

let handle: Sql | null = null;

export function db(): Sql {
  if (handle) return handle;
  const url = process.env["DATABASE_URL"];
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env, then `docker compose up -d`."
    );
  }
  handle = postgres(url, {
    // Bun loads .env automatically; postgres.js keeps its own pool.
    max: 8,
    onnotice: () => {},
    transform: { undefined: null },
  });
  return handle;
}

export async function closeDb(): Promise<void> {
  if (handle) {
    await handle.end({ timeout: 5 });
    handle = null;
  }
}
