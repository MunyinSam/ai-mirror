import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const VAULT_CONFIG = resolve(
  process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~",
  ".claude/vault-config.json"
);

export interface VaultConcept {
  title: string;
  /** raw frontmatter value: "learning" | "solid" | "fluent" | null */
  confidence: string | null;
}

/** Vault confidence → U (0-3). A filed note without confidence counts as U1. */
export function confidenceToU(confidence: string | null): number {
  switch (confidence) {
    case "fluent": return 3;
    case "solid": return 2;
    default: return 1;
  }
}

/** Scan the vault's concept notes. Returns [] if no vault is configured —
 *  everything downstream degrades gracefully to tags-only. */
export function loadVaultConcepts(): VaultConcept[] {
  if (!existsSync(VAULT_CONFIG)) return [];
  try {
    const { vault_path } = JSON.parse(readFileSync(VAULT_CONFIG, "utf8")) as {
      vault_path: string;
    };
    const files = Array.from(
      new Bun.Glob(`${vault_path.replace(/\\/g, "/")}/concepts/**/*.md`).scanSync()
    ).filter((f) => !f.endsWith("_moc.md"));

    const concepts: VaultConcept[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      const title = text.match(/^title:\s*(.+)$/m)?.[1]?.trim();
      if (!title) continue;
      const confidence = text.match(/^confidence:\s*(.+)$/m)?.[1]?.trim() ?? null;
      concepts.push({ title, confidence });
    }
    return concepts;
  } catch {
    return [];
  }
}
