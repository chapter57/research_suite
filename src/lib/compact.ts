// Keeps the recording compact: consecutive keystrokes are merged into one
// event per word (or burst of deletions). The replay then shows writing
// word by word instead of letter by letter, which is plenty for reflection
// and makes long projects far smaller.
import type { Step } from "@tiptap/pm/transform";
import type { StepJSON } from "./types.ts";

/** Keystrokes further apart than this start a new event. */
export const MERGE_GAP_MS = 2000;
/** A merged event never spans longer than this. */
export const MAX_SPAN_MS = 15000;

export interface PendingTyping {
  t0: number; // time of the first keystroke in the event
  t: number; // time of the latest keystroke
  steps: Step[];
  inserted: number;
  /** The last thing typed was whitespace, so the next word starts a new event. */
  endedWord: boolean;
}

function insertedText(step: Step): string {
  const slice = (step as unknown as { slice?: { content: { textBetween(a: number, b: number, sep?: string): string; size: number } } }).slice;
  return slice ? slice.content.textBetween(0, slice.content.size, "\n") : "";
}

/**
 * Try to fold a new plain-typing transaction into the pending event.
 * Returns true if it was merged (and `pending` was updated in place).
 */
export function mergeTyping(pending: PendingTyping, t: number, steps: readonly Step[], inserted: number): boolean {
  if (t - pending.t > MERGE_GAP_MS || t - pending.t0 > MAX_SPAN_MS || pending.endedWord) return false;
  const text = steps.map(insertedText).join("");
  for (const s of steps) {
    const last = pending.steps[pending.steps.length - 1];
    const merged = last?.merge(s);
    if (merged) pending.steps[pending.steps.length - 1] = merged;
    else pending.steps.push(s);
  }
  pending.t = t;
  pending.inserted += inserted;
  pending.endedWord = /\s$/.test(text);
  return true;
}

export function startTyping(t: number, steps: readonly Step[], inserted: number): PendingTyping {
  const text = steps.map(insertedText).join("");
  return { t0: t, t, steps: [...steps], inserted, endedWord: /\s$/.test(text) };
}

export function stepsToJSON(steps: readonly Step[]): StepJSON[] {
  return steps.map((s) => s.toJSON() as StepJSON);
}
