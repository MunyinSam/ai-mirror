// Tiny ANSI helper. Colors auto-disable when piped or NO_COLOR is set.
const on = process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined;

const wrap = (code: number) => (s: string) => (on ? `\x1b[${code}m${s}\x1b[0m` : s);

export const c = {
  bold: wrap(1),
  dim: wrap(2),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  magenta: wrap(35),
  cyan: wrap(36),
};

/** Horizontal you-vs-AI bar, green for you, red for AI. Falls back to
 *  distinct characters when colors are unavailable. */
export function splitBar(aiPct: number, width = 24): string {
  const ai = Math.round((aiPct / 100) * width);
  const you = width - ai;
  return on
    ? c.green("█".repeat(you)) + c.red("█".repeat(ai))
    : "█".repeat(you) + "░".repeat(ai);
}
