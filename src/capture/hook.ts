#!/usr/bin/env bun
// PostToolUse hook — the provenance capture point. Deliberately dumb and
// fast: parse stdin, append one JSONL line to a local queue file, exit.
// No database, no network, no LLM. If this hook is slow or throws, it
// degrades your own editor loop, so the failure mode for anything unexpected
// is "write nothing and exit 0" — never block the tool call it's watching.
//
// Blind spots (by design — a future git-side gate is the universal net):
//   - code written via Bash heredocs
//   - Copilot completions / pasting from a browser chat
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { CODE_LANGS, SNIPPET_CAP, type QueuedEvent } from "../types.ts";
import { gitRepoRoot, langOf, normalizePath, sha256 } from "../util.ts";

const QUEUE_DIR = join(process.env["HOME"] ?? "", ".ai-mirror", "queue");

interface EditInput {
  file_path?: string;
  old_string?: string;
  new_string?: string;
  content?: string;
  edits?: { old_string: string; new_string: string }[];
}

interface HookInput {
  tool_name: string;
  tool_input: EditInput;
  cwd?: string;
  session_id?: string;
}

/** Pull {before, after} out of the three tool shapes that write code.
 *  MultiEdit is a blind spot in the old hook (Edit|Write only) — closing it
 *  here means a multi-hunk agent edit isn't silently invisible to the mirror. */
function extractText(toolName: string, input: EditInput): { before: string | null; after: string } | null {
  if (toolName === "Write") {
    return { before: null, after: input.content ?? "" };
  }
  if (toolName === "Edit") {
    return { before: input.old_string ?? "", after: input.new_string ?? "" };
  }
  if (toolName === "MultiEdit" && input.edits) {
    // Concatenate each hunk's old/new with a separator. This is a queue-time
    // approximation — the real per-line diff happens once in ingest, against
    // this same before/after pair, so the approximation only has to be
    // faithful to "what changed", not perfectly ordered.
    const before = input.edits.map((e) => e.old_string).join("\n");
    const after = input.edits.map((e) => e.new_string).join("\n");
    return { before, after };
  }
  return null;
}

const raw = await Bun.stdin.text();

try {
  const input = JSON.parse(raw) as HookInput;

  // The settings matcher is an unanchored regex, so filter explicitly rather
  // than trust it — "Edit|Write" also matches "NotebookEdit".
  const text =
    input.tool_name === "Edit" || input.tool_name === "Write" || input.tool_name === "MultiEdit"
      ? extractText(input.tool_name, input.tool_input)
      : null;

  if (text) {
    const file = normalizePath(input.tool_input.file_path ?? "");
    const lang = langOf(file);

    const truncated = text.after.length > SNIPPET_CAP || (text.before?.length ?? 0) > SNIPPET_CAP;
    const event: QueuedEvent = {
      ts: new Date().toISOString(),
      tool: input.tool_name,
      session_id: input.session_id,
      // Prefer the git repo root of the file actually edited — in a
      // multi-root workspace, cwd is the launch directory, not necessarily
      // the repo touched.
      repo: gitRepoRoot(dirname(file)) ?? normalizePath(input.cwd ?? process.cwd()),
      file,
      lang,
      code_hash: sha256(text.after),
      before_text: text.before === null ? null : text.before.slice(0, SNIPPET_CAP),
      after_text: text.after.slice(0, SNIPPET_CAP),
      truncated,
    };
    // lang gate is intentionally absent here: non-code files (json, md,
    // config) are still captured — CODE_LANGS is applied downstream, at
    // attribution/classification time, not at capture time. Capture must be
    // free of judgment calls that could later turn out wrong.
    void CODE_LANGS;

    mkdirSync(QUEUE_DIR, { recursive: true });
    const day = event.ts.slice(0, 10);
    appendFileSync(join(QUEUE_DIR, `${day}.jsonl`), JSON.stringify(event) + "\n");
  }
} catch {
  // Never let a malformed payload or a filesystem error surface to the
  // editor loop — this hook is not allowed to be the reason a tool call fails.
}

process.exit(0);
