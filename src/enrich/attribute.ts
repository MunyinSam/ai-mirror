// Line attribution — matches added commit lines against AI-written snippets
// to decide how many of them are AI's. Replaces the old handwritten.ts
// approach (one repo-wide Set of AI lines, no file scope, no time window),
// which meant an AI line from January permanently "poisoned" an identical
// human line typed in July. Candidate scoping (per-file, per-window) happens
// in attributeCommit (stage 4b); these two functions fix the line-matching
// itself.

/** Canonical form of a line for matching: trims edges and collapses internal
 *  whitespace to single spaces, so reformatting (e.g. prettier) doesn't
 *  defeat the match just because indentation or spacing changed.
 *
 *  Limit: only whitespace is normalized. A style change that isn't
 *  whitespace (quote style, trailing commas) still breaks the match. */
export function normalizeKey(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}

/** Demotes isolated line matches to non-matches, keeping only runs of at
 *  least `runMin` CONSECUTIVE matched lines.
 *
 *  Why: a single matched line is weak evidence — common one-liners (e.g.
 *  "return null;") get written independently by AI and humans all the time,
 *  so one coincidental match shouldn't count as proof. A run of `runMin`+
 *  consecutive matches means a whole structural chunk lines up, which is a
 *  much stronger signal that it's the same code.
 *
 *  `runMin = 3` is a tuning constant, not a derived value — it trades
 *  false positives for false negatives. Lower it and coincidental short
 *  matches start counting as AI (overcounts). Raise it and genuine short
 *  AI edits (a 2-line fix) get counted as human instead (undercounts). This
 *  system is deliberately biased toward undercounting AI: for a tool whose
 *  whole point is self-honesty, a falsely low number is a safer failure
 *  than a falsely high one. Treat `runMin` as an empirical knob — once real
 *  attribution data exists, try 2/3/4 against commits you can eyeball. */
export function coalesceRuns(marks: boolean[], runMin = 3): boolean[] {
  const result = [...marks];
  let runStart: number | null = null;

  const closeRun = (end: number) => {
    if (runStart === null) return;
    if (end - runStart < runMin) {
      for (let i = runStart; i < end; i++) result[i] = false;
    }
    runStart = null;
  };

  for (let i = 0; i < marks.length; i++) {
    if (marks[i] && runStart === null) runStart = i;
    if (!marks[i]) closeRun(i);
  }
  closeRun(marks.length);

  return result;
}

/** Which of a commit's added lines are AI's, given the AI's candidate
 *  snippets (the after_text of AI events scoped to this file/time-window —
 *  that scoping happens in attributeCommit, not here). Composes the two
 *  functions above: normalize both sides so formatting can't hide a match,
 *  then require a run so a lone coincidental line can't fake one. */
export interface LineAttribution {
  addedLines: number;
  aiLines: number;
}

export function markAiLines(
  addedLines: string[],
  aiSnippets: string[],
  runMin = 3
): LineAttribution {
  const aiKeys = new Set<string>();
  for (const snippet of aiSnippets) {
    for (const line of snippet.split("\n")) {
      aiKeys.add(normalizeKey(line));
    }
  }

  const marks = addedLines.map((line) => aiKeys.has(normalizeKey(line)));
  const coalesced = coalesceRuns(marks, runMin);
  const aiLines = coalesced.filter(Boolean).length;

  return { addedLines: addedLines.length, aiLines };
}
