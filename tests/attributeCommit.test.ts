// Golden-fixture integration test: a real temp git repo + the real Postgres
// instance. Proves the pieces you built (normalizeKey, coalesceRuns,
// markAiLines) work end-to-end once wired to actual commits, covering the
// scenarios from the rewrite plan's verification section.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, db } from "../src/db/client.ts";
import { attributeCommit } from "../src/enrich/attributeCommit.ts";
import { sha256 } from "../src/util.ts";

let repo: string;

function git(cmd: string, env: Record<string, string> = {}) {
  execSync(`git ${cmd}`, { cwd: repo, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, ...env } });
}

function commitAll(message: string, iso: string): { sha: string; ts: string } {
  git("add -A");
  git(`-c user.email=test@test.dev -c user.name=Test commit -m "${message}"`, {
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_DATE: iso,
  });
  const sha = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }).trim();
  const ts = execSync("git show -s --format=%cI HEAD", { cwd: repo, encoding: "utf8" }).trim();
  return { sha, ts };
}

async function insertCommitRow(sha: string, ts: string) {
  await db()`
    INSERT INTO commits (repo, sha, ts, author_email, subject)
    VALUES (${repo}, ${sha}, ${ts}, 'test@test.dev', 'test')
  `;
}

async function insertAiEvent(file: string, afterText: string, iso: string) {
  const after_text = afterText;
  await db()`
    INSERT INTO events (event_uid, ts, tool, repo, file, lang, code_hash, before_text,
                         after_text, added_lines, removed_lines, truncated)
    VALUES (${sha256(file + iso + after_text)}, ${iso}, 'Edit', ${repo}, ${repo + "/" + file},
            'ts', ${sha256(after_text)}, NULL, ${after_text},
            ${after_text.split("\n").length}, 0, false)
  `;
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "ai-mirror-attrib-repo-"));
  git("init -q");
});

afterAll(async () => {
  await db()`DELETE FROM attributions WHERE commit_id IN (SELECT id FROM commits WHERE repo = ${repo})`;
  await db()`DELETE FROM commits WHERE repo = ${repo}`;
  await db()`DELETE FROM events WHERE repo = ${repo}`;
  await closeDb();
});

describe("attributeCommit — golden fixtures", () => {
  test("100% AI: committed lines exactly match a prior AI event", async () => {
    const aiCode = "function foo() {\n  return 1;\n}";
    await insertAiEvent("a.ts", aiCode, "2026-01-01T00:01:00Z");
    writeFileSync(join(repo, "a.ts"), aiCode + "\n"); // trailing newline avoids a git EOF-diff quirk
    const { sha, ts } = commitAll("ai commit", "2026-01-01T00:02:00Z");
    await insertCommitRow(sha, ts);

    await attributeCommit(db(), repo, sha);

    const [row] = await db()<
      { added_lines: number; ai_lines: number; human_lines: number }[]
    >`SELECT added_lines, ai_lines, human_lines FROM attributions
      WHERE commit_id = (SELECT id FROM commits WHERE sha = ${sha}) AND file = 'a.ts'`;
    expect(row).toEqual({ added_lines: 3, ai_lines: 3, human_lines: 0 });
  });

  test("100% human: no AI event exists for this file", async () => {
    writeFileSync(join(repo, "b.ts"), "const x = 1;\nconst y = 2;\nconst z = 3;\n");
    const { sha, ts } = commitAll("human commit", "2026-01-01T00:03:00Z");
    await insertCommitRow(sha, ts);

    await attributeCommit(db(), repo, sha);

    const [row] = await db()<
      { added_lines: number; ai_lines: number }[]
    >`SELECT added_lines, ai_lines FROM attributions
      WHERE commit_id = (SELECT id FROM commits WHERE sha = ${sha}) AND file = 'b.ts'`;
    expect(row).toEqual({ added_lines: 3, ai_lines: 0 });
  });

  test("interleaved: AI block and human block added in the same commit", async () => {
    const aiBlock = "function bar() {\n  return 2;\n}";
    await insertAiEvent("a.ts", aiBlock, "2026-01-01T00:04:00Z");
    const existing = "function foo() {\n  return 1;\n}";
    writeFileSync(
      join(repo, "a.ts"),
      `${existing}\n${aiBlock}\nconst human1 = 1;\nconst human2 = 2;`
    );
    const { sha, ts } = commitAll("interleaved commit", "2026-01-01T00:05:00Z");
    await insertCommitRow(sha, ts);

    await attributeCommit(db(), repo, sha);

    const [row] = await db()<
      { added_lines: number; ai_lines: number }[]
    >`SELECT added_lines, ai_lines FROM attributions
      WHERE commit_id = (SELECT id FROM commits WHERE sha = ${sha}) AND file = 'a.ts'`;
    // this commit adds: the 3-line AI block + 2 human lines = 5 added lines.
    expect(row).toEqual({ added_lines: 5, ai_lines: 3 });
  });

  test("pure rename: no added lines, no attribution row created", async () => {
    git("mv b.ts b2.ts");
    const { sha, ts } = commitAll("rename commit", "2026-01-01T00:06:00Z");
    await insertCommitRow(sha, ts);

    await attributeCommit(db(), repo, sha);

    const rows = await db()`SELECT * FROM attributions
      WHERE commit_id = (SELECT id FROM commits WHERE sha = ${sha})`;
    expect(rows.length).toBe(0);
  });

  test("attributeCommit is idempotent: re-running doesn't duplicate or error", async () => {
    const sha = (
      await db()<{ sha: string }[]>`SELECT sha FROM commits WHERE repo = ${repo} ORDER BY ts LIMIT 1`
    )[0]!.sha;

    await attributeCommit(db(), repo, sha);
    await attributeCommit(db(), repo, sha);

    const rows = await db()`SELECT * FROM attributions
      WHERE commit_id = (SELECT id FROM commits WHERE sha = ${sha})`;
    expect(rows.length).toBe(1);
  });
});
