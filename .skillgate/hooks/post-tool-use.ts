import { appendFileSync } from "fs";
import { resolve } from "path";

const LOG_PATH = resolve(import.meta.dir, "../data/events.jsonl");

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  const event = JSON.parse(raw) as {
    tool_name: string;
    tool_input: Record<string, string>;
  };

  if (event.tool_name !== "Edit" && event.tool_name !== "Write") {
    process.exit(0);
  }

  const code =
    event.tool_name === "Write"
      ? event.tool_input["content"] ?? ""
      : event.tool_input["new_string"] ?? "";

  const entry = {
    ts: new Date().toISOString(),
    author: "ai",
    tool: event.tool_name,
    file: event.tool_input["file_path"] ?? "",
    lines: code.split("\n").length,
  };

  appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n", "utf8");
  process.exit(0);
});
