import { createHash } from "node:crypto";

export function sha256(text: string): string {
  return "sha256:" + createHash("sha256").update(text, "utf8").digest("hex");
}

/** Normalize a path so the same repo isn't split by drive-letter case or
 *  forward/back slashes (e.g. "d:\Foo" vs "D:/Foo"). */
export function normalizePath(p: string): string {
  const withSlashes = p.replace(/\\/g, "/");
  return /^[a-z]:/i.test(withSlashes)
    ? withSlashes[0]!.toUpperCase() + withSlashes.slice(1)
    : withSlashes;
}

/** Extension without the dot, lowercased: "src/a.TS" → "ts"; "" if none. */
export function langOf(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1).slice(file.lastIndexOf("\\") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

export function daysBetween(fromIso: string, to: Date): number {
  return Math.floor((to.getTime() - new Date(fromIso).getTime()) / 86_400_000);
}
