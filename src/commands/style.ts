import { existsSync } from "node:fs";
import { dataPaths } from "../config.ts";
import { loadSamples, rebuildProfile } from "../style.ts";

export async function styleCommand(args: string[]): Promise<void> {
  const paths = dataPaths();

  if (args.includes("--rebuild")) {
    try {
      const profile = await rebuildProfile(paths.styleSamples, paths.styleProfile, paths.styleGuide);
      console.log(`✓ Profile rebuilt for: ${Object.keys(profile).join(", ") || "(no languages)"}`);
      console.log(`✓ ${paths.styleProfile}`);
      console.log(`✓ ${paths.styleGuide}`);
      console.log("\nTo make Claude Code write in your style, reference the guide from your");
      console.log("global ~/.claude/CLAUDE.md, e.g.:");
      console.log(`  Follow my personal style guide: ${paths.styleGuide}`);
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  const samples = loadSamples(paths.styleSamples);
  const byLang = new Map<string, number>();
  for (const s of samples) byLang.set(s.lang, (byLang.get(s.lang) ?? 0) + 1);

  console.log(`\nStyle corpus: ${samples.length} verified hand-written sample(s)`);
  for (const [lang, n] of byLang) console.log(`   ${lang.padEnd(6)} ${n}`);
  console.log(
    existsSync(paths.styleProfile)
      ? `\nProfile: ${paths.styleProfile}\nGuide:   ${paths.styleGuide}`
      : "\nNo profile yet — run `mirror style --rebuild`."
  );
  console.log();
}
