import { Parser, Language, Query } from "web-tree-sitter";
import { resolve } from "path";

const WASM_DIR = resolve(import.meta.dir, "../node_modules");

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

async function init() {
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

export async function detectConcepts(
  code: string,
  filePath: string
): Promise<string[]> {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();

  await init();
  const lang = await getLanguage(ext);
  if (!lang) return [];

  const parser = new Parser();
  parser.setLanguage(lang);

  const tree = parser.parse(code);
  if (!tree) return [];

  const queryStr = ext === ".py" ? PY_QUERY : TS_QUERY;
  const query = new Query(lang, queryStr);
  const matches = query.matches(tree.rootNode);

  return [
    ...new Set(matches.flatMap((m) => m.captures.map((c: { name: string }) => c.name))),
  ];
}
