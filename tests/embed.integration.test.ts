// Integration test — needs DATABASE_URL (real Postgres+pgvector, schema
// applied) and OLLAMA_URL (real Ollama running nomic-embed-text). Proves the
// "near-miss titles resolve correctly" claim from the plan: a paraphrase of
// a real vault title resolves to it by cosine distance; an unrelated title
// does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeDb, db } from "../src/db/client.ts";
import { embedConcept, resolveNearMissConcepts } from "../src/enrich/embed.ts";

const OLLAMA_URL = process.env["OLLAMA_URL"] ?? "http://localhost:11434";
const testTitle = `React Hooks (test-${Date.now()})`;
const testDescription =
  "Functions like useState and useEffect that let function components hold state and side effects without a class.";

describe("resolveNearMissConcepts", () => {
  beforeAll(async () => {
    const [row] = await db()<{ id: number }[]>`
      INSERT INTO concepts (title, description, source)
      VALUES (${testTitle}, ${testDescription}, 'test') RETURNING id
    `;
    await embedConcept(OLLAMA_URL, db(), row!.id, testTitle, testDescription);
  });

  afterAll(async () => {
    await db()`DELETE FROM concepts WHERE title = ${testTitle}`;
    await closeDb();
  });

  test("a paraphrase resolves to the real vault title", async () => {
    const resolved = await resolveNearMissConcepts(OLLAMA_URL, db(), ["useState hook"]);
    expect(resolved.get("useState hook")).toBe(testTitle);
  });

  test("an unrelated title does not resolve", async () => {
    const resolved = await resolveNearMissConcepts(OLLAMA_URL, db(), ["SQL Window Functions"]);
    expect(resolved.has("SQL Window Functions")).toBe(false);
  });
});
