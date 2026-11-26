"use client";
// Word (.docx) and PDF builders for a Paper. MLA: Times New Roman 12pt,
// double-spaced, 1" margins, last name + page number in the header,
// half-inch first-line indents, hanging indents in Works Cited.
import { AlignmentType, Document, Header, Packer, PageNumber, Paragraph, TextRun } from "docx";
import { lastName, type Block, type Paper, type Run } from "./paperModel";

const INCH = 1440; // docx twips

function docxRuns(runs: Run[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    const lines = r.text.split("\n");
    lines.forEach((line, i) => out.push(new TextRun({ text: line, bold: r.bold, italics: r.italic, underline: r.underline ? {} : undefined, break: i > 0 ? 1 : undefined })));
  }
  return out;
}

function docxBlock(b: Block, mla: boolean): Paragraph {
  const runs = docxRuns(b.runs);
  switch (b.kind) {
    case "heading":
      return new Paragraph({ children: docxRuns(b.runs.map((r) => ({ ...r, bold: true }))), keepNext: true });
    case "citedHeading":
      return new Paragraph({ children: runs, alignment: AlignmentType.CENTER, pageBreakBefore: true });
    case "citation":
      return new Paragraph({ children: runs, indent: { left: INCH / 2, hanging: INCH / 2 } });
    case "quote":
      return new Paragraph({ children: runs, indent: { left: INCH / 2 } });
    case "bullet":
      return new Paragraph({ children: [new TextRun("•\t"), ...runs], indent: { left: INCH / 2, hanging: INCH / 4 } });
    case "number":
      return new Paragraph({ children: [new TextRun(`${b.n}.\t`), ...runs], indent: { left: INCH / 2, hanging: INCH / 4 } });
    default:
      return new Paragraph({ children: runs, indent: mla ? { firstLine: INCH / 2 } : undefined, spacing: mla ? undefined : { after: 160 } });
  }
}

export async function paperToDocx(paper: Paper): Promise<Blob> {
  const mla = paper.mla;
  const children: Paragraph[] = [];
  if (mla) {
    for (const line of [mla.name, mla.instructor, mla.course, mla.date]) children.push(new Paragraph({ children: [new TextRun(line)] }));
  }
  children.push(new Paragraph({ children: [new TextRun({ text: paper.title, bold: !mla })], alignment: AlignmentType.CENTER }));
  for (const b of paper.blocks) children.push(docxBlock(b, !!mla));

  const doc = new Document({
    creator: mla?.name || "Research Suite",
    title: paper.title,
    styles: {
      default: {
        document: {
          run: { font: "Times New Roman", size: 24 },
          paragraph: { spacing: { line: mla ? 480 : 276, before: 0, after: 0 } },
        },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: INCH, right: INCH, bottom: INCH, left: INCH, header: INCH / 2 } } },
        headers: mla
          ? {
              default: new Header({
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun(`${lastName(mla.name)} `), new TextRun({ children: [PageNumber.CURRENT] })] })],
              }),
            }
          : undefined,
        children,
      },
    ],
  });
  return Packer.toBlob(doc);
}

// ---------- PDF ----------
// Measured: pdfmake's Times line at 12pt is about 10.7pt, so 2.24 gives the
// 24pt baseline-to-baseline spacing of true double spacing.
const DOUBLE = 2.24;

type PdfText = { text: string; bold?: boolean; italics?: boolean; decoration?: "underline" };
function pdfRuns(runs: Run[]): PdfText[] {
  return runs.map((r) => ({ text: r.text, bold: r.bold, italics: r.italic, decoration: r.underline ? ("underline" as const) : undefined }));
}

export async function paperToPdf(paper: Paper): Promise<Blob> {
  const [{ default: pdfMake }, { default: times }] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/standard-fonts/Times"),
  ]);
  pdfMake.addFontContainer(times);
  const mla = paper.mla;
  const lh = mla ? DOUBLE : 1.15;
  const gap = mla ? 0 : 8;
  const content: Record<string, unknown>[] = [];
  if (mla) for (const line of [mla.name, mla.instructor, mla.course, mla.date]) content.push({ text: line });
  content.push({ text: paper.title, alignment: "center", bold: !mla, margin: [0, 0, 0, gap] });

  for (const b of paper.blocks) {
    const text = pdfRuns(b.runs);
    switch (b.kind) {
      case "heading":
        content.push({ text: text.map((t) => ({ ...t, bold: true })), margin: [0, 0, 0, gap] });
        break;
      case "citedHeading":
        content.push({ text, alignment: "center", pageBreak: "before" });
        break;
      case "citation":
        content.push({ text, margin: [36, 0, 0, gap], leadingIndent: -36 });
        break;
      case "quote":
        content.push({ text, margin: [36, 0, 0, gap] });
        break;
      case "bullet":
      case "number":
        content.push({ columns: [{ width: 18, text: b.kind === "bullet" ? "•" : `${b.n}.` }, { width: "*", text }], margin: [18, 0, 0, gap] });
        break;
      default:
        content.push({ text, leadingIndent: mla ? 36 : 0, margin: [0, 0, 0, gap] });
    }
  }

  const def = {
    pageSize: "LETTER",
    pageMargins: [72, 72, 72, 72],
    info: { title: paper.title, author: mla?.name },
    defaultStyle: { font: "Times", fontSize: 12, lineHeight: lh },
    header: mla ? (page: number) => ({ text: `${lastName(mla.name)} ${page}`, alignment: "right", margin: [72, 36, 72, 0], lineHeight: 1 }) : undefined,
    content,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pdfMake.createPdf(def as any).getBlob();
}
