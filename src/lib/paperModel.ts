// Turns the editor's document into a simple list of formatted blocks that the
// Word and PDF exporters both understand. MLA conventions live here.

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export type BlockKind = "title" | "heading" | "para" | "quote" | "bullet" | "number" | "citedHeading" | "citation";

export interface Block {
  kind: BlockKind;
  runs: Run[];
  /** Number shown for numbered list items. */
  n?: number;
  /** Start this block on a new page (Works Cited). */
  pageBreakBefore?: boolean;
}

export interface MlaInfo {
  name: string;
  instructor: string;
  course: string;
  date: string;
}

export interface Paper {
  title: string;
  blocks: Block[];
  mla: MlaInfo | null;
}

type PMJson = { type: string; text?: string; marks?: { type: string }[]; content?: PMJson[]; attrs?: Record<string, unknown> };

function runsOf(node: PMJson): Run[] {
  const runs: Run[] = [];
  for (const c of node.content ?? []) {
    if (c.type === "text" && c.text) {
      const m = new Set((c.marks ?? []).map((x) => x.type));
      runs.push({ text: c.text, bold: m.has("bold") || undefined, italic: m.has("italic") || undefined, underline: m.has("underline") || undefined });
    } else if (c.type === "hardBreak") {
      runs.push({ text: "\n" });
    }
  }
  return runs;
}

export function plainText(runs: Run[]) {
  return runs.map((r) => r.text).join("");
}

/** "26 November 2026": the date style MLA uses in the heading. */
export function mlaDate(d = new Date()) {
  return `${d.getDate()} ${d.toLocaleString("en-US", { month: "long" })} ${d.getFullYear()}`;
}

export function lastName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || "";
}

export function buildPaper(docJson: Record<string, unknown> | null, projectTitle: string, mla: MlaInfo | null): Paper {
  const top = ((docJson as PMJson | null)?.content ?? []) as PMJson[];
  const blocks: Block[] = [];
  let title = projectTitle;
  let inWorksCited = false;
  let first = true;

  const pushPara = (node: PMJson, kind: BlockKind) => {
    const runs = runsOf(node);
    if (!plainText(runs).trim()) return;
    blocks.push({ kind, runs });
  };

  const bodyPara = (node: PMJson, kind: BlockKind) => {
    const runs = runsOf(node);
    const text = plainText(runs).trim();
    if (!text) return;
    if (!inWorksCited && /^works\s+cited:?$/i.test(text)) {
      inWorksCited = true;
      blocks.push({ kind: "citedHeading", runs: [{ text: "Works Cited" }], pageBreakBefore: true });
    } else {
      blocks.push({ kind: inWorksCited ? "citation" : kind, runs });
    }
  };

  for (const node of top) {
    const isFirst = first;
    first = false;
    switch (node.type) {
      case "heading": {
        const runs = runsOf(node);
        const text = plainText(runs).trim();
        if (!text) break;
        if (isFirst && node.attrs?.level === 1) {
          title = text; // the student's own title line
        } else if (/^works\s+cited:?$/i.test(text)) {
          inWorksCited = true;
          blocks.push({ kind: "citedHeading", runs: [{ text: "Works Cited" }], pageBreakBefore: true });
        } else {
          blocks.push({ kind: "heading", runs });
        }
        break;
      }
      case "paragraph":
        bodyPara(node, "para");
        break;
      case "blockquote":
        // Students sometimes end up typing Works Cited inside a quotation block.
        for (const c of node.content ?? []) bodyPara(c, "quote");
        break;
      case "bulletList":
      case "orderedList": {
        let n = Number(node.attrs?.start ?? 1);
        for (const item of node.content ?? []) {
          const runs = (item.content ?? []).flatMap((p, i) => (i ? [{ text: " " }, ...runsOf(p)] : runsOf(p)));
          if (!plainText(runs).trim()) continue;
          blocks.push(node.type === "bulletList" ? { kind: "bullet", runs } : { kind: "number", runs, n: n++ });
        }
        break;
      }
      case "codeBlock":
        pushPara(node, "para");
        break;
      default:
        break;
    }
  }
  return { title, blocks, mla };
}
