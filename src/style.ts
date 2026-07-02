// Style corpus & profile (PLAN Phase 4): verified hand-written code is raw
// material for a profile of HOW you write, so allowed AI generation can sound
// like you. Corpus is append-only JSONL — the exact shape a future local LLM
// on the Mac mini would RAG or fine-tune over (see docs/pg-migration.md).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { StyleSample } from "./types.ts";

const PROFILE_MODEL = "claude-sonnet-5";
/** max corpus characters sent per language when distilling */
const PROFILE_INPUT_CAP = 60_000;

export function loadSamples(samplesPath: string): StyleSample[] {
  if (!existsSync(samplesPath)) return [];
  return readFileSync(samplesPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as StyleSample);
}

/** Append new samples, deduped by code hash. Returns how many were new. */
export function appendSamples(samplesPath: string, samples: StyleSample[]): number {
  const seen = new Set(loadSamples(samplesPath).map((s) => s.hash));
  const fresh: StyleSample[] = [];
  for (const s of samples) {
    if (seen.has(s.hash)) continue;
    seen.add(s.hash);
    fresh.push(s);
  }
  if (fresh.length === 0) return 0;
  mkdirSync(dirname(samplesPath), { recursive: true });
  appendFileSync(samplesPath, fresh.map((s) => JSON.stringify(s)).join("\n") + "\n", "utf8");
  return fresh.length;
}

export interface LangTraits {
  naming: string;
  functions: string;
  error_handling: string;
  comments: string;
  structure: string;
  idioms: string[];
  avoids: string[];
}

export type StyleProfile = Record<string, LangTraits>; // keyed by lang

/** Distill traits for one language from its samples — structured output via a
 *  forced tool, same pattern as the classifier. */
async function distillLang(
  client: Anthropic,
  lang: string,
  samples: StyleSample[]
): Promise<LangTraits | null> {
  let corpus = "";
  // Newest first — recent habits describe you better than old ones.
  for (const s of [...samples].reverse()) {
    if (corpus.length + s.code.length > PROFILE_INPUT_CAP) break;
    corpus += `--- ${s.file} (${s.ts.slice(0, 10)}) ---\n${s.code}\n\n`;
  }
  if (!corpus) return null;

  const response = await client.messages.create({
    model: PROFILE_MODEL,
    max_tokens: 2048,
    tools: [
      {
        name: "record_style",
        description: "Record the author's observable coding style traits.",
        input_schema: {
          type: "object" as const,
          properties: {
            naming: { type: "string", description: "variable/function naming conventions observed" },
            functions: { type: "string", description: "typical function size, shape, early-return vs nesting" },
            error_handling: { type: "string", description: "how errors are handled or ignored" },
            comments: { type: "string", description: "comment density, placement, tone" },
            structure: { type: "string", description: "module/file organization habits" },
            idioms: { type: "array", items: { type: "string" }, description: "recurring constructs the author reaches for" },
            avoids: { type: "array", items: { type: "string" }, description: "things notably absent that peers commonly use" },
          },
          required: ["naming", "functions", "error_handling", "comments", "structure", "idioms", "avoids"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "record_style" },
    messages: [
      {
        role: "user",
        content: `These are verified hand-written ${lang} code samples by one author. Describe the author's observable style. Only report what the samples actually show — no invention, no flattery.\n\n${corpus}`,
      },
    ],
  });

  const block = response.content.find((b) => b.type === "tool_use");
  return block?.type === "tool_use" ? (block.input as unknown as LangTraits) : null;
}

export async function rebuildProfile(
  samplesPath: string,
  profilePath: string,
  guidePath: string
): Promise<StyleProfile> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY required to rebuild the style profile");
  const samples = loadSamples(samplesPath);
  if (samples.length === 0) throw new Error("style corpus is empty — run `mirror ledger sync` first");

  const byLang = new Map<string, StyleSample[]>();
  for (const s of samples) {
    byLang.set(s.lang, [...(byLang.get(s.lang) ?? []), s]);
  }

  const client = new Anthropic({ apiKey });
  const profile: StyleProfile = {};
  for (const [lang, langSamples] of byLang) {
    const traits = await distillLang(client, lang, langSamples);
    if (traits) profile[lang] = traits;
  }

  mkdirSync(dirname(profilePath), { recursive: true });
  writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf8");
  writeFileSync(guidePath, renderGuide(profile, samples.length), "utf8");
  return profile;
}

/** Deterministic markdown render of the profile — meant to be referenced from
 *  a global CLAUDE.md so every session writes in the author's style. */
export function renderGuide(profile: StyleProfile, sampleCount: number): string {
  const lines: string[] = [
    "# Personal Code Style Guide",
    "",
    `> Distilled from ${sampleCount} provenance-verified hand-written samples by AI Mirror.`,
    "> When generating code for this author, match these observed habits.",
    "",
  ];
  for (const [lang, t] of Object.entries(profile)) {
    lines.push(
      `## ${lang}`,
      "",
      `- **Naming:** ${t.naming}`,
      `- **Functions:** ${t.functions}`,
      `- **Error handling:** ${t.error_handling}`,
      `- **Comments:** ${t.comments}`,
      `- **Structure:** ${t.structure}`,
      ...(t.idioms.length ? [`- **Reaches for:** ${t.idioms.join("; ")}`] : []),
      ...(t.avoids.length ? [`- **Avoids:** ${t.avoids.join("; ")}`] : []),
      ""
    );
  }
  return lines.join("\n");
}
