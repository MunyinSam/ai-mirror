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

interface VaultConfig {
  vault_path: string;
  /** the previous vault, kept read-only for on-demand imports via /gaps */
  archive_vault_path?: string;
}

export function getVaultConfig(): VaultConfig | null {
  if (!existsSync(VAULT_CONFIG)) return null;
  try {
    return JSON.parse(readFileSync(VAULT_CONFIG, "utf8")) as VaultConfig;
  } catch {
    return null;
  }
}

/** Scan a vault's concept notes. Returns [] if the path doesn't exist —
 *  everything downstream degrades gracefully to tags-only. */
export function loadVaultConceptsFrom(vaultPath: string): VaultConcept[] {
  try {
    const files = Array.from(
      new Bun.Glob(`${vaultPath.replace(/\\/g, "/")}/concepts/**/*.md`).scanSync()
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

/** Concept notes from the active vault. */
export function loadVaultConcepts(): VaultConcept[] {
  const config = getVaultConfig();
  return config ? loadVaultConceptsFrom(config.vault_path) : [];
}

/** Concept notes from the archived (pre-Stage-2) vault, for /gaps imports. */
export function loadArchiveConcepts(): VaultConcept[] {
  const config = getVaultConfig();
  return config?.archive_vault_path ? loadVaultConceptsFrom(config.archive_vault_path) : [];
}
