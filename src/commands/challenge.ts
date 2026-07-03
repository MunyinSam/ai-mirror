// No-AI challenges (PLAN Stage 3, T2) — the airtight P verification.
// `mirror challenge <concept>` generates an exercise into a sandbox; the user
// hand-types the solution; `mirror challenge grade` verifies provenance (no AI
// event may touch the sandbox) and has the LLM grade against the rubric.
// Commit-inference only ever proves presence (P1); challenges are the only
// path to L2–L4.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { dataPaths } from "../config.ts";
import { c } from "../colors.ts";
import { effectiveP, loadLedger, saveLedger } from "../ledger.ts";
import { readEvents } from "../log.ts";
import { normalizePath } from "../util.ts";

const CHALLENGE_MODEL = "claude-sonnet-5";

interface ChallengeMeta {
  concept: string;
  level: number;
  created: string;
  rubric: string[];
  solution_file: string;
  graded: boolean;
  passed?: boolean;
}

function requireClient(): Anthropic {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    console.error("✗ ANTHROPIC_API_KEY required for challenges (generation and grading).");
    process.exit(1);
  }
  return new Anthropic({ apiKey });
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export async function challengeCommand(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "grade") return grade(args.slice(1));
  if (sub === "list") return list();
  if (!sub) {
    console.error("Usage: mirror challenge <concept> | grade [slug] | list");
    process.exit(1);
  }
  return create(args.join(" ").trim());
}

async function create(concept: string): Promise<void> {
  const paths = dataPaths();
  const ledger = loadLedger(paths.skills);
  const entry = ledger.concepts[concept];
  if (!entry) {
    console.log(`⚠ "${concept}" is not in the ledger — check the exact vault title with \`mirror ledger\`.`);
    console.log("  Proceeding anyway; a pass will create the entry.");
  }
  const level = Math.min(4, (entry ? effectiveP(entry) : 0) + 1);

  const client = requireClient();
  console.log(`Generating a level-${level} challenge for "${concept}"…`);

  const response = await client.messages.create({
    model: CHALLENGE_MODEL,
    max_tokens: 2048,
    tools: [
      {
        name: "record_challenge",
        description: "Record a hand-typeable coding challenge.",
        input_schema: {
          type: "object" as const,
          properties: {
            spec_markdown: {
              type: "string",
              description: "the exercise: goal, constraints, example input/output. 15–60 lines of code to write, self-contained, no external services",
            },
            rubric: {
              type: "array",
              items: { type: "string" },
              description: "3–6 concrete pass/fail checks a grader can verify by reading the code",
            },
            solution_filename: { type: "string", description: 'e.g. "solution.ts" or "solution.py"' },
          },
          required: ["spec_markdown", "rubric", "solution_filename"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "record_challenge" },
    messages: [
      {
        role: "user",
        content: `Design a coding challenge for the concept "${concept}" at level ${level} of 4 (1 = apply it in the simplest form, 4 = advanced/stateful/edge-case-complete). The user will HAND-TYPE the solution with no AI help, so keep it 15–60 lines, self-contained (standard library only), and gradeable by reading the code.`,
      },
    ],
  });

  const block = response.content.find((b) => b.type === "tool_use");
  if (block?.type !== "tool_use") {
    console.error("✗ Challenge generation failed — try again.");
    process.exit(1);
  }
  const gen = block.input as { spec_markdown: string; rubric: string[]; solution_filename: string };

  const slug = `${slugify(concept)}-${new Date().toISOString().slice(0, 10)}`;
  const dir = resolve(paths.challengesDir, slug);
  mkdirSync(dir, { recursive: true });

  const meta: ChallengeMeta = {
    concept,
    level,
    created: new Date().toISOString(),
    rubric: gen.rubric,
    solution_file: gen.solution_filename,
    graded: false,
  };
  writeFileSync(resolve(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  writeFileSync(
    resolve(dir, "README.md"),
    `# Challenge: ${concept} (level ${level})\n\n${gen.spec_markdown}\n\n## Rubric\n\n${gen.rubric.map((r) => `- ${r}`).join("\n")}\n\n## Rules\n\n- HAND-TYPE your solution into \`${gen.solution_filename}\` in this folder.\n- No AI assistance of any kind — AI edits in this folder are detected at grading and void the attempt.\n- When done: \`mirror challenge grade\`\n`,
    "utf8"
  );
  writeFileSync(resolve(dir, gen.solution_filename), "", "utf8");

  console.log(`\n✓ Challenge created: ${dir}`);
  console.log(`  1. Read README.md`);
  console.log(`  2. Hand-type your solution into ${gen.solution_filename} (no AI — it's checked)`);
  console.log(`  3. Run \`mirror challenge grade\``);
}

function latestUngraded(challengesDir: string): string | null {
  if (!existsSync(challengesDir)) return null;
  const dirs = readdirSync(challengesDir)
    .filter((d) => existsSync(resolve(challengesDir, d, "meta.json")))
    .sort()
    .reverse();
  for (const d of dirs) {
    const meta = JSON.parse(readFileSync(resolve(challengesDir, d, "meta.json"), "utf8")) as ChallengeMeta;
    if (!meta.graded) return d;
  }
  return null;
}

async function grade(args: string[]): Promise<void> {
  const paths = dataPaths();
  const slug = args[0] ?? latestUngraded(paths.challengesDir);
  if (!slug) {
    console.log("No ungraded challenge found. Create one: `mirror challenge <concept>`");
    return;
  }
  const dir = resolve(paths.challengesDir, slug);
  const metaPath = resolve(dir, "meta.json");
  if (!existsSync(metaPath)) {
    console.error(`✗ No challenge at ${dir}`);
    process.exit(1);
  }
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as ChallengeMeta;
  const solutionPath = resolve(dir, meta.solution_file);
  const solution = existsSync(solutionPath) ? readFileSync(solutionPath, "utf8") : "";
  if (solution.trim().length === 0) {
    console.log(`Solution file is empty: ${solutionPath}`);
    return;
  }

  // Provenance check: authorship certain by construction. Any AI edit event
  // touching this sandbox voids the attempt.
  const sandbox = normalizePath(dir).toLowerCase();
  const aiTouched = readEvents(paths.events).some(
    (e) => e.author === "ai" && normalizePath(e.file).toLowerCase().startsWith(sandbox)
  );
  if (aiTouched) {
    console.log(c.red(`✗ VOID — AI edits were logged inside this challenge sandbox.`));
    console.log(`  The point is producing it yourself. Start fresh: mirror challenge "${meta.concept}"`);
    return;
  }

  const client = requireClient();
  console.log(`Grading "${meta.concept}" (level ${meta.level})…`);

  const response = await client.messages.create({
    model: CHALLENGE_MODEL,
    max_tokens: 1500,
    tools: [
      {
        name: "record_grade",
        description: "Record the grading result for a coding challenge.",
        input_schema: {
          type: "object" as const,
          properties: {
            pass: { type: "boolean" },
            criteria: {
              type: "array",
              items: {
                type: "object",
                properties: { check: { type: "string" }, met: { type: "boolean" } },
                required: ["check", "met"],
              },
            },
            feedback: { type: "string", description: "2-4 sentences; concrete, no flattery" },
          },
          required: ["pass", "criteria", "feedback"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "record_grade" },
    messages: [
      {
        role: "user",
        content: `Grade this hand-written solution strictly against the rubric. Minor style issues don't fail; a rubric item not met does.\n\nRubric:\n${meta.rubric.map((r) => `- ${r}`).join("\n")}\n\nSolution (${meta.solution_file}):\n\`\`\`\n${solution.slice(0, 8000)}\n\`\`\``,
      },
    ],
  });

  const block = response.content.find((b) => b.type === "tool_use");
  if (block?.type !== "tool_use") {
    console.error("✗ Grading failed — try again.");
    process.exit(1);
  }
  const result = block.input as {
    pass: boolean;
    criteria: { check: string; met: boolean }[];
    feedback: string;
  };

  console.log("");
  for (const cr of result.criteria) {
    console.log(`   ${cr.met ? c.green("✓") : c.red("✗")} ${cr.check}`);
  }
  console.log(`\n${result.feedback}\n`);

  meta.graded = true;
  meta.passed = result.pass;
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");

  if (result.pass) {
    const ledger = loadLedger(paths.skills);
    const entry = (ledger.concepts[meta.concept] ??= {
      understanding: 0,
      coding_level: 0,
      last_produced: null,
      decay_days: { u: 180, p: 45 },
      evidence: [],
    });
    entry.evidence.push({ type: "produced", ref: `challenge:${slug}`, date: new Date().toISOString() });
    entry.coding_level = Math.max(entry.coding_level, meta.level);
    entry.last_produced = new Date().toISOString();
    saveLedger(paths.skills, ledger);
    console.log(c.green(`✓ PASSED — "${meta.concept}" verified at P${meta.level}.`));
  } else {
    console.log(c.yellow(`✗ Not yet — the attempt stays; fix and re-run \`mirror challenge grade ${slug}\`.`));
    meta.graded = false; // allow regrade after fixing
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
  }
}

function list(): void {
  const paths = dataPaths();
  if (!existsSync(paths.challengesDir)) {
    console.log("No challenges yet. `mirror challenge <concept>` to start one.");
    return;
  }
  for (const d of readdirSync(paths.challengesDir).sort()) {
    const metaPath = resolve(paths.challengesDir, d, "meta.json");
    if (!existsSync(metaPath)) continue;
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as ChallengeMeta;
    const status = meta.passed ? c.green("passed") : meta.graded ? c.red("failed") : c.yellow("open");
    console.log(`   ${status}  ${d}  (${meta.concept}, L${meta.level})`);
  }
}
