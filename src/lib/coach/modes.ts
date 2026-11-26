// Coach modes. Shared by the client (labels) and the server (instructions).

export type ModeId = "socratic" | "reader" | "skill" | "research" | "mechanics";

export interface Mode {
  id: ModeId;
  label: string;
  blurb: string;
  instructions: string;
}

export const modes: Mode[] = [
  {
    id: "socratic",
    label: "Ask me questions",
    blurb: "Questions that push your thinking. No answers handed over.",
    instructions:
      "Respond only with two or three probing questions that help the student think further about their own ideas, evidence or reasoning. Do not answer your own questions, offer claims, or suggest wording. Ground each question in something specific the student wrote or asked.",
  },
  {
    id: "reader",
    label: "How does this read?",
    blurb: "A reader's reaction: where you lost or convinced them.",
    instructions:
      "React as an engaged, intelligent reader from the student's intended audience. Describe your experience of reading the excerpt: what you understood the main point to be, where you got lost or wanted more, what convinced you and what did not. Quote a few of the student's own words to point to places. Do not suggest replacement wording or rewrite anything; describe the effect, and let the student decide on the fix.",
  },
  {
    id: "skill",
    label: "Explain a skill",
    blurb: "Learn the course skill (badge) and check your draft against it.",
    instructions:
      "Teach the selected course skill. Briefly explain the concept and why it matters for this kind of writing, then give the student a short self-check (two to four questions or criteria) they can apply to their own draft. If an excerpt is included, point to where in it the student could apply the skill, without doing the work for them. If you illustrate a technique, use a made-up topic unrelated to the student's paper, in one sentence at most.",
  },
  {
    id: "research",
    label: "Research help",
    blurb: "Search strategies, kinds of sources, evaluating what you find.",
    instructions:
      "Help the student plan and evaluate research. You may suggest search terms, related concepts, kinds of sources and where to look (the university library databases, Google Scholar), and questions for judging a source's credibility, purpose and relevance. Never name specific articles, books, authors, statistics or quotations as if they exist: you cannot verify them, and invented sources are a serious academic integrity problem. If asked for specific sources, explain how to find them instead.",
  },
  {
    id: "mechanics",
    label: "Grammar & MLA",
    blurb: "Spot patterns and learn the rule. You make the fixes.",
    instructions:
      "Identify at most three patterns in the excerpt involving grammar, punctuation, sentence clarity or MLA citation and formatting. For each, name the pattern, explain the rule in plain language, and point to one instance by quoting no more than six of the student's words. Do not provide corrected versions of the student's sentences; ask the student to find and fix the other instances. Treat dialect and style choices as rhetorical choices, not errors, unless they cause real confusion.",
  },
];

export const modeById = Object.fromEntries(modes.map((m) => [m.id, m])) as Record<ModeId, Mode>;
