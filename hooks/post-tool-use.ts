import { appendFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { detectConcepts } from "../classifier";

// Load .env from repo root
const envPath = resolve(import.meta.dir, "../.env");
const envText = await Bun.file(envPath).text().catch(() => "");
for (const line of envText.split("\n")) {
  const [key, ...rest] = line.split("=");
  if (key && rest.length) Bun.env[key.trim()] ??= rest.join("=").trim();
}

const LOG_PATH = resolve(import.meta.dir, "../data/events.jsonl");
mkdirSync(dirname(LOG_PATH), { recursive: true });

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
    project: process.cwd(),
    lines: code.split("\n").length,
    concepts,
  };

  appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n", "utf8");
  process.exit(0);
})();
