// Course settings. For version 0.1 the instructor edits this file;
// a settings screen comes with instructor accounts.
import type { ModeId } from "@/lib/coach/modes";

export const course = {
  /** Show the AI coach at all. */
  aiAvailable: true,
  /** Is the coach switched on when a student opens a project? */
  aiOnByDefault: false,
  /** Which coach modes students may use. */
  allowedModes: ["socratic", "reader", "skill", "research", "mechanics"] as ModeId[],
  /** Stop students copying text out of the coach panel. */
  blockCopyFromCoach: true,
  /** Longest draft excerpt sent to the coach, in characters. */
  maxExcerptChars: 6000,
};
