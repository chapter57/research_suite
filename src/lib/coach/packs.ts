// Discipline packs. A pack tells the coach which skills the course is teaching
// and how to talk about them. Faculty can add packs by copying this shape.

export interface Skill {
  id: string;
  name: string;
  /** The course's own statement of purpose for this skill (shown to students). */
  purpose: string;
  /** Guidance for the coach: what to look for and what to ask about. */
  coachFocus: string;
}

export interface Pack {
  id: string;
  course: string;
  title: string;
  level: string;
  citationStyle: string;
  /** What "good" looks like in this course, in a few sentences for the coach. */
  context: string;
  skills: Skill[];
}

// Skills follow the English 102 badges published at https://ccc.coastal.edu/102-2/
export const engl102: Pack = {
  id: "engl102",
  course: "ENGL 102",
  title: "Composition and Critical Reading",
  level: "first-year college composition (second semester)",
  citationStyle: "MLA 9th edition",
  context:
    "Students are learning to read sources closely and critically, to summarize, critique, analyze and synthesize what others have said, and to place their own perspective inside a larger scholarly conversation for a specific audience. Progress is organized as skill badges.",
  skills: [
    {
      id: "reading-actively",
      name: "Reading Actively",
      purpose:
        "Introduces strategies central to active and critical reading, so you can read texts in close and careful ways as you formulate specific reactions and responses to them.",
      coachFocus:
        "Annotation, questioning a text, noticing an author's claims, evidence, assumptions and moves; turning reactions into specific, text-based responses.",
    },
    {
      id: "critiquing",
      name: "Critiquing",
      purpose:
        "Shows how summary and critique work together to situate writing within larger scholarly conversations; you summarize sources as a way to begin critically engaging them.",
      coachFocus:
        "Fair, accurate summary before evaluation; separating what a source says from what the student thinks of it; criteria for critique; signal phrases.",
    },
    {
      id: "analyzing",
      name: "Analyzing",
      purpose:
        "Helps you create space for analysis: revealing the deeper meanings, ideas, motives and relationships within a text, and using outside sources to enrich your analysis.",
      coachFocus:
        "Moving from what a text says to how and why it says it; unpacking quotations rather than dropping them; the ratio of quotation to commentary; using outside sources as lenses.",
    },
    {
      id: "synthesizing-ii",
      name: "Synthesizing II",
      purpose:
        "Shows how summarizing and paraphrasing are used when synthesizing sources, so you can synthesize what others have said about a topic as you articulate your own perspective.",
      coachFocus:
        "Putting sources in conversation (agreement, tension, extension) rather than summarizing them one by one; accurate paraphrase versus patchwriting; where the student's own voice enters.",
    },
    {
      id: "imagining-readers",
      name: "Imagining Readers",
      purpose:
        "Stresses audience awareness: the many ways you might convey information depending on context, so you become more responsive to readers' expectations.",
      coachFocus:
        "Who the reader is, what they already know and believe, what they need defined or justified, and where they would push back.",
    },
    {
      id: "shifting-styles-ii",
      name: "Shifting Styles II",
      purpose:
        "Highlights how modes of communication and language choices carry power, so you can make rhetorical decisions about usage and style that fit your purpose, audience and context.",
      coachFocus:
        "Register, word choice, dialect and code-meshing as rhetorical choices, not errors; asking what a choice does for this audience rather than prescribing 'correct' style.",
    },
    {
      id: "paragraphing-ii",
      name: "Paragraphing II",
      purpose:
        "Builds on Paragraphing I so you can identify different kinds of paragraphs and use them in your own writing.",
      coachFocus:
        "Paragraph purposes (introducing, summarizing, analyzing, synthesizing, conceding, transitioning, concluding); whether each paragraph does one job; how paragraphs hand off to each other.",
    },
  ],
};

export const packs: Record<string, Pack> = { [engl102.id]: engl102 };
