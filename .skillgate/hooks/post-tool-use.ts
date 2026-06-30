import { appendFileSync } from "fs";
import { resolve } from "path";
import { detectConcepts } from "../../src/classifier";

const LOG_PATH = resolve(import.meta.dir, "../data/events.jsonl");

(async () => {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;

  const event = JSON.parse(raw) as {
    tool_name: string;
    tool_input: Record<string, string>;
  };

  if (event.tool_name !== "Edit" && event.tool_name !== "Write") {
    process.exit(0);
  }

  const filePath = event.tool_input["file_path"] ?? "";
  const code =
    event.tool_name === "Write"
      ? event.tool_input["content"] ?? ""
      : event.tool_input["new_string"] ?? "";

  const concepts = await detectConcepts(code, filePath);

  const entry = {
    ts: new Date().toISOString(),
    author: "ai",
    tool: event.tool_name,
    file: filePath,
    lines: code.split("\n").length,
    concepts,
  };

  appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n", "utf8");
  process.exit(0);
})();
