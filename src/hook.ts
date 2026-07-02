// PostToolUse hook — the provenance capture point (CONCEPTS §6).
// Deliberately dumb and fast: parse stdin, append one JSONL line, exit.
// No LLM, no tree-sitter, no network, no API key. Classification happens
// lazily at report time (see classifier.ts).
//
// Known blind spots (by design — the v3 git gate is the universal net):
//   - code the agent writes via Bash heredocs or NotebookEdit
//   - Copilot completions / pasting from a browser chat
import { dataPaths } from "./config.ts";
import { appendEvent } from "./log.ts";
import { SNIPPET_CAP, type MirrorEvent } from "./types.ts";
import { langOf, normalizePath, sha256 } from "./util.ts";

const raw = await Bun.stdin.text();

const input = JSON.parse(raw) as {
  tool_name: string;
  tool_input: Record<string, string>;
  cwd?: string;
};

// The settings matcher is an unanchored regex ("Edit|Write" also matches
// NotebookEdit), so filter explicitly.
if (input.tool_name === "Edit" || input.tool_name === "Write") {
  const file = normalizePath(input.tool_input["file_path"] ?? "");
  const code =
    input.tool_name === "Write"
      ? input.tool_input["content"] ?? ""
      : input.tool_input["new_string"] ?? "";

  const event: MirrorEvent = {
    v: 2,
    ts: new Date().toISOString(),
    author: "ai",
    tool: input.tool_name,
    file,
    project: normalizePath(input.cwd ?? process.cwd()),
    lang: langOf(file),
    lines: code.split("\n").length,
    code_hash: sha256(code),
    snippet: code.slice(0, SNIPPET_CAP),
  };

  appendEvent(dataPaths().events, event);
}

process.exit(0);
