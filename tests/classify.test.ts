import { describe, expect, test } from "bun:test";
import { getSyntaxTags, resolveConcepts } from "../src/enrich/classify.ts";

describe("resolveConcepts", () => {
  test("keeps only proposed titles that exact-match the vault", () => {
    const vault = new Set(["React Hooks", "Async/Await"]);
    expect(resolveConcepts(["React Hooks", "Made Up Thing"], [], vault)).toEqual({
      concepts: ["React Hooks"],
      suggested: [],
    });
  });

  test("deduplicates concepts", () => {
    const vault = new Set(["React Hooks"]);
    expect(resolveConcepts(["React Hooks", "React Hooks"], [], vault).concepts).toEqual([
      "React Hooks",
    ]);
  });

  test("passes through unfiled suggestions not in the vault", () => {
    const vault = new Set(["React Hooks"]);
    expect(resolveConcepts([], ["Python Decorator Factory"], vault).suggested).toEqual([
      "Python Decorator Factory",
    ]);
  });

  test("drops an 'unfiled' guess that actually matches a real vault title", () => {
    const vault = new Set(["React Hooks"]);
    expect(resolveConcepts([], ["React Hooks"], vault).suggested).toEqual([]);
  });

  test("deduplicates suggested", () => {
    const vault = new Set<string>();
    expect(
      resolveConcepts([], ["Python Decorator Factory", "Python Decorator Factory"], vault)
        .suggested
    ).toEqual(["Python Decorator Factory"]);
  });

  test("no proposals, empty vault -> both empty", () => {
    expect(resolveConcepts([], [], new Set())).toEqual({ concepts: [], suggested: [] });
  });
});

describe("getSyntaxTags", () => {
  test("tags async/await in TypeScript", async () => {
    const tags = await getSyntaxTags("async function f() { await g(); }", "ts");
    expect(tags).toContain("async_await");
  });

  test("tags a try/catch in TypeScript", async () => {
    const tags = await getSyntaxTags("try { f(); } catch (e) { g(); }", "ts");
    expect(tags).toContain("try_catch");
  });

  test("tags a decorator in Python", async () => {
    const tags = await getSyntaxTags("@staticmethod\ndef f():\n    pass", "py");
    expect(tags).toContain("decorator");
  });

  test("unsupported language returns no tags", async () => {
    expect(await getSyntaxTags("# just markdown", "md")).toEqual([]);
  });

  test("code with none of the queried constructs returns no tags", async () => {
    expect(await getSyntaxTags("const x = 1;", "ts")).toEqual([]);
  });
});
