import { Parser, Language, Query } from "web-tree-sitter";
import { readFileSync } from "fs";
import { resolve } from "path";
import Anthropic from "@anthropic-ai/sdk";

const WASM_DIR = resolve(import.meta.dir, "node_modules");
const VAULT_CONFIG = resolve(
  process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~",
  ".claude/vault-config.json"
);

const GRAMMARS: Record<string, string> = {
  ".ts": `${WASM_DIR}/tree-sitter-typescript/tree-sitter-typescript.wasm`,
  ".tsx": `${WASM_DIR}/tree-sitter-typescript/tree-sitter-tsx.wasm`,
  ".js": `${WASM_DIR}/tree-sitter-javascript/tree-sitter-javascript.wasm`,
  ".jsx": `${WASM_DIR}/tree-sitter-javascript/tree-sitter-javascript.wasm`,
  ".py": `${WASM_DIR}/tree-sitter-python/tree-sitter-python.wasm`,
};

const TS_QUERY = `
  (await_expression) @async_await
  (arrow_function) @arrow_function
  (decorator) @decorator
  (try_statement) @try_catch
  (class_declaration) @class
  (interface_declaration) @interface
  (type_alias_declaration) @type_alias
  (generic_type) @generics
`;

const PY_QUERY = `
  (await) @async_await
  (decorated_definition) @decorator
  (try_statement) @try_catch
  (class_definition) @class
  (lambda) @lambda
  (list_comprehension) @comprehension
  (generator_expression) @comprehension
`;

let initialized = false;
const langCache = new Map<string, Language>();

async function initParser() {
  if (initialized) return;
  await Parser.init({
    locateFile: () => `${WASM_DIR}/web-tree-sitter/web-tree-sitter.wasm`,
  });
  initialized = true;
}

async function getLanguage(ext: string): Promise<Language | null> {
  const wasmPath = GRAMMARS[ext];
  if (!wasmPath) return null;
  if (langCache.has(ext)) return langCache.get(ext)!;
  const lang = await Language.load(wasmPath);
  langCache.set(ext, lang);
  return lang;
}

function getSyntaxTags(code: string, lang: Language, ext: string): string[] {
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(code);
  if (!tree) return [];
  const query = new Query(lang, ext === ".py" ? PY_QUERY : TS_QUERY);
  const matches = query.matches(tree.rootNode);
  return [
    ...new Set(
      matches.flatMap((m) => m.captures.map((c: { name: string }) => c.name))
    ),
  ];
}

function loadVaultConcepts(): string[] {
  try {
    const config = JSON.parse(readFileSync(VAULT_CONFIG, "utf8")) as {
      vault_path: string;
    };
    const files = Array.from(
      new Bun.Glob(`${config.vault_path}/concepts/**/*.md`).scanSync()
    ).filter((f) => !f.endsWith("_moc.md"));

    return files
      .map((f) => {
        const match = readFileSync(f, "utf8").match(/^title:\s*(.+)$/m);
        return match?.[1]?.trim() ?? "";
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function mapToVaultConcepts(
  code: string,
  syntaxTags: string[],
  vaultConcepts: string[]
): Promise<string[]> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey || vaultConcepts.length === 0) return syntaxTags;

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `You are a code concept tagger. Given a code snippet and a list of concepts from the user's knowledge vault, return ONLY the vault concepts that this code uses or requires understanding of.

Vault concepts:
${vaultConcepts.join(", ")}

Syntax patterns detected: ${syntaxTags.join(", ")}

Code:
\`\`\`
${code.slice(0, 800)}
\`\`\`

Return a JSON array of matching vault concept titles exactly as listed above. Return [] if none match. No explanation.`,
      },
    ],
  });

  try {
    const text =
      response.content[0]?.type === "text" ? response.content[0].text : "[]";
    const parsed = JSON.parse(text.match(/\[.*\]/s)?.[0] ?? "[]") as string[];
    return parsed.length > 0 ? parsed : syntaxTags;
  } catch {
    return syntaxTags;
  }
}

export async function detectConcepts(
  code: string,
  filePath: string
): Promise<string[]> {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();

  await initParser();
  const lang = await getLanguage(ext);
  if (!lang) return [];

  const syntaxTags = getSyntaxTags(code, lang, ext);
  if (syntaxTags.length === 0) return [];

  const vaultConcepts = loadVaultConcepts();
  return mapToVaultConcepts(code, syntaxTags, vaultConcepts);
}
