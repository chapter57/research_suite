// Course kits ("cartridges"): what the AI coach knows about a course.
// A kit describes the whole course (its catalog identity, ethos and the
// objectives that run through every assignment), not individual assignments.

export interface Objective {
  name: string;
  description: string;
  /** Questions the coach can raise when helping with this objective. */
  questions: string[];
}

export interface KitContent {
  subject: string; // English
  number: string; // 102
  title: string; // Composition and Critical Reading
  institution?: string;
  level: string; // e.g. "first-year undergraduate"
  description: string; // the course's ethos, in a few sentences
  objectiveLabel: string; // singular: Objective, Badge, Lens, Outcome
  objectives: Objective[];
  citationStyle: string;
  guidance?: string; // the teacher's priorities for the coach
}

/** A kit as plugged into a class: a frozen copy. */
export interface ClassKit extends KitContent {
  kitId: string | null;
  version: number;
}

export function catalogTitle(k: Pick<KitContent, "subject" | "number" | "title">): string {
  const code = [k.subject, k.number].map((s) => s.trim()).filter(Boolean).join(" ");
  return code && k.title.trim() ? `${code}: ${k.title.trim()}` : code || k.title.trim() || "Untitled course";
}

export function withArticle(word: string): string {
  return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}

/** Basic checks before a kit is saved or used. Returns problems in plain words. */
export function kitProblems(k: KitContent): string[] {
  const p: string[] = [];
  if (!k.subject.trim()) p.push("Add the subject (for example, English).");
  if (!k.number.trim()) p.push("Add the course number (for example, 102).");
  if (!k.title.trim()) p.push("Add the course title as it appears in the catalog.");
  if (!k.objectiveLabel.trim()) p.push("Name what the objectives are called (for example, Objective, Badge or Lens).");
  if (!k.objectives.some((o) => o.name.trim())) p.push(`Add at least one ${k.objectiveLabel.toLowerCase() || "objective"}.`);
  return p;
}

/** Keep kits to a sensible size and shape (also used on the server). */
export function cleanKit(raw: unknown): KitContent {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const objs = Array.isArray(r.objectives) ? r.objectives.slice(0, 30) : [];
  return {
    subject: str(r.subject, 60),
    number: str(r.number, 20),
    title: str(r.title, 120),
    institution: str(r.institution, 120) || undefined,
    level: str(r.level, 80),
    description: str(r.description, 2000),
    objectiveLabel: str(r.objectiveLabel, 30) || "Objective",
    objectives: objs.map((o) => {
      const x = (o ?? {}) as Record<string, unknown>;
      return {
        name: str(x.name, 80),
        description: str(x.description, 800),
        questions: (Array.isArray(x.questions) ? x.questions : []).slice(0, 8).map((q) => str(q, 300)).filter(Boolean),
      };
    }),
    citationStyle: str(r.citationStyle, 60),
    guidance: str(r.guidance, 2000) || undefined,
  };
}

// ---------------- Starter kits ----------------

// Objectives follow the English 102 badges published at https://ccc.coastal.edu/102-2/
export const english102: KitContent = {
  subject: "English",
  number: "102",
  title: "Composition and Critical Reading",
  institution: "Coastal Carolina University",
  level: "first-year undergraduate (second-semester composition)",
  description:
    "Students learn to read sources closely and critically, to summarize, critique, analyze and synthesize what others have said, and to place their own perspective inside a larger scholarly conversation for a specific audience. Progress is organized as skill badges.",
  objectiveLabel: "Badge",
  objectives: [
    {
      name: "Reading Actively",
      description: "Strategies for close, careful, critical reading that lead to specific, text-based reactions and responses.",
      questions: ["What is this author claiming, and what evidence do they offer?", "Where do you agree, disagree or feel unsure, and why?", "What assumptions does the text rely on?"],
    },
    {
      name: "Critiquing",
      description: "Using fair, accurate summary as the starting point for evaluating a source within a larger scholarly conversation.",
      questions: ["Could the author accept your summary as fair?", "By what criteria are you judging this source?", "Where does summary end and your evaluation begin?"],
    },
    {
      name: "Analyzing",
      description: "Revealing the deeper meanings, motives and relationships in a text, and using outside sources to enrich the analysis.",
      questions: ["How does the text say this, not just what does it say?", "Why might the author have made this choice?", "What does this quotation show that you need to explain to your reader?"],
    },
    {
      name: "Synthesizing II",
      description: "Using summary and paraphrase to put sources in conversation while articulating one's own perspective.",
      questions: ["Where do your sources agree, disagree or build on each other?", "Where does your own voice enter the conversation?", "Is this paraphrase truly in your own words and structure?"],
    },
    {
      name: "Imagining Readers",
      description: "Audience awareness: conveying information in ways that respond to readers' knowledge, beliefs and expectations.",
      questions: ["Who is your reader, and what do they already know?", "Where would they push back?", "What would they need defined or justified?"],
    },
    {
      name: "Shifting Styles II",
      description: "Making deliberate choices about language, usage and style, aware of how language carries power, for a purpose, audience and context.",
      questions: ["What does this word choice do for your reader?", "Whose language and conventions does this style favor?", "Is this choice deliberate, and could you explain it?"],
    },
    {
      name: "Paragraphing II",
      description: "Recognizing different kinds of paragraphs and using them purposefully in one's own writing.",
      questions: ["What job does this paragraph do?", "Is it doing one job or several?", "How does it hand off to the next paragraph?"],
    },
  ],
  citationStyle: "MLA 9th edition",
  guidance: "Treat dialect, style and code-meshing as rhetorical choices, not errors, unless they cause real confusion.",
};

export const literaryLenses: KitContent = {
  subject: "English",
  number: "",
  title: "Literary Theory and Criticism",
  level: "upper-level undergraduate",
  description:
    "Students learn to read literary texts through a range of critical lenses, to articulate what each lens reveals and conceals, and to build interpretive arguments grounded in close reading and in the theorists who shaped each approach.",
  objectiveLabel: "Lens",
  objectives: [
    {
      name: "Formalism / New Criticism",
      description: "Meaning arises from the text's form: imagery, structure, tension, irony and paradox, read closely on their own terms.",
      questions: ["How do the text's formal patterns create meaning?", "Where do tension or paradox resolve, or refuse to?"],
    },
    {
      name: "Marxist",
      description: "Literature reflects and shapes material conditions, class relations and ideology.",
      questions: ["Whose labor is visible here, and whose is invisible?", "What ideology does the text reinforce or challenge?", "How does class shape what characters can want or do?"],
    },
    {
      name: "Feminist",
      description: "How texts construct, reinforce or resist gender roles and patriarchal power.",
      questions: ["Who has voice and agency, and who is spoken for?", "What expectations about gender does the text assume?", "Where does the text resist those expectations?"],
    },
    {
      name: "Psychoanalytic",
      description: "Texts as expressions of desire, repression, the unconscious and psychological development.",
      questions: ["What desires drive the characters, and which are hidden?", "What is repressed or displaced in the text?", "How do symbols carry unconscious meaning?"],
    },
    {
      name: "New Historicism",
      description: "Reading texts alongside the historical and cultural discourses of their time, with attention to power.",
      questions: ["What other documents of the period does this text speak to?", "How does the text circulate or contest power?"],
    },
    {
      name: "Postcolonial",
      description: "Representations of empire, colonization, identity and resistance, and whose stories are centered.",
      questions: ["Whose perspective is centered and whose is marginalized?", "How does the text represent the colonized or the 'other'?"],
    },
    {
      name: "Reader-Response",
      description: "Meaning is made in the act of reading, shaped by readers and their communities.",
      questions: ["How does your experience of reading change over the text?", "How might a different community of readers respond?"],
    },
    {
      name: "Ecocriticism",
      description: "The relationship between literature and the physical environment, and how texts imagine nature and the human place in it.",
      questions: ["How does the text represent the natural world?", "What does it assume about humans' relationship to nature?"],
    },
  ],
  citationStyle: "MLA 9th edition",
  guidance: "Push students to name the theorists behind a lens and to show what a lens reveals and what it leaves out, not just to apply its vocabulary.",
};

/** Used when a project isn't for any class. */
export const generalWriting: KitContent = {
  subject: "",
  number: "",
  title: "General Academic Writing",
  level: "college",
  description: "Writing as a way of thinking: developing a question, reading sources well, building an argument from evidence, and writing clearly for readers.",
  objectiveLabel: "Skill",
  objectives: [
    { name: "Question and claim", description: "Turning a topic into a real question and an arguable claim.", questions: ["What question is your paper answering?", "Could a reasonable person disagree with your claim?"] },
    { name: "Evidence and sources", description: "Choosing, evaluating and explaining evidence from credible sources.", questions: ["How does this evidence support your claim?", "Why should a reader trust this source?"] },
    { name: "Organization", description: "Arranging paragraphs in a logical progression toward the paper's point.", questions: ["Why does this paragraph come here?", "What does each paragraph contribute to the whole?"] },
    { name: "Audience", description: "Writing for real readers: what they know, need and believe.", questions: ["Who is your reader?", "Where would they get lost or push back?"] },
    { name: "Clarity and style", description: "Short, exact sentences in words you'd be comfortable saying aloud.", questions: ["Can this sentence be shorter?", "Is each word the precise one you mean?"] },
  ],
  citationStyle: "the style your instructor requires (MLA if unsure)",
};

export const starters: { id: string; label: string; blurb: string; kit: KitContent }[] = [
  { id: "english102", label: "English 102: Composition and Critical Reading", blurb: "The seven ENGL 102 skill badges.", kit: english102 },
  { id: "lenses", label: "Literary Theory and Criticism", blurb: "Eight critical lenses, from formalism to ecocriticism.", kit: literaryLenses },
  {
    id: "blank",
    label: "Blank kit",
    blurb: "Start from scratch with your own objectives.",
    kit: { subject: "", number: "", title: "", level: "", description: "", objectiveLabel: "Objective", objectives: [{ name: "", description: "", questions: [] }], citationStyle: "MLA 9th edition" },
  },
];
