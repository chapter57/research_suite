import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPaper, lastName, mlaDate } from "./paperModel.ts";

const p = (text: string, marks: string[] = []) => ({ type: "paragraph", content: [{ type: "text", text, marks: marks.map((type) => ({ type })) }] });
const h = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });

test("MLA paper: title, body, quote, works cited", () => {
  const doc = {
    type: "doc",
    content: [
      h(1, "Clicks and Civics"),
      p("Opening claim."),
      { type: "paragraph" }, // empty line ignored
      { type: "blockquote", content: [p("A long quotation.")] },
      p("Analysis with ", []),
      h(2, "Works Cited"),
      p("Author, A. "),
      p("Author, B. ", ["italic"]),
    ],
  };
  const paper = buildPaper(doc, "Project name", { name: "Ada Lovelace", instructor: "Prof. X", course: "ENGL 102", date: "1 May 2027" });
  assert.equal(paper.title, "Clicks and Civics");
  assert.deepEqual(paper.blocks.map((b) => b.kind), ["para", "quote", "para", "citedHeading", "citation", "citation"]);
  assert.equal(paper.blocks[3].pageBreakBefore, true);
  assert.equal(paper.blocks[5].runs[0].italic, true);
});

test("project title used when the draft has no title line; lists numbered", () => {
  const doc = {
    type: "doc",
    content: [p("Body."), { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [p("one")] }, { type: "listItem", content: [p("two")] }] }],
  };
  const paper = buildPaper(doc, "My Project", null);
  assert.equal(paper.title, "My Project");
  assert.deepEqual(paper.blocks.map((b) => [b.kind, b.n]), [["para", undefined], ["number", 1], ["number", 2]]);
});

test("helpers", () => {
  assert.equal(lastName("  Mary Ann Evans "), "Evans");
  assert.equal(mlaDate(new Date(2026, 10, 26)), "26 November 2026");
});

test("Works Cited typed inside a block quote still starts the list", () => {
  const doc = { type: "doc", content: [p("Body."), { type: "blockquote", content: [p("Quoted."), p("Works Cited"), p("Smith, J. Book.")] }] };
  const paper = buildPaper(doc, "T", null);
  assert.deepEqual(paper.blocks.map((b) => b.kind), ["para", "quote", "citedHeading", "citation"]);
});
