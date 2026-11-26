"use client";
// The writing screen: editor + process recorder + coach panel.
import Placeholder from "@tiptap/extension-placeholder";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { course } from "@/config/course";
import { downloadBlob, safeFilename } from "@/lib/download";
import { ReplayEngine, wordCount } from "@/lib/replay";
import { getDocSchema, schemaExtensions } from "@/lib/schema";
import { appendEvents, exportProject, getEvents, getProject, putProject } from "@/lib/store";
import type { AiEvent, Project, RecEvent } from "@/lib/types";
import CoachPanel from "./CoachPanel";

export default function Writer({ projectId }: { projectId: string }) {
  const [loaded, setLoaded] = useState<{ project: Project; doc: PMNode; seq: number; failures: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const project = await getProject(projectId);
      if (!project) return setError("Project not found on this device.");
      if (project.imported) return setError("This is a shared recording. It can be replayed but not edited.");
      const events = await getEvents(projectId);
      const engine = new ReplayEngine(getDocSchema(), events);
      const doc = engine.final();
      setLoaded({ project, doc, seq: events.length, failures: engine.failures });
    })().catch((e) => setError(String(e)));
  }, [projectId]);

  if (error) return <main className="home"><p className="error">{error}</p><Link href="/">Back to projects</Link></main>;
  if (!loaded) return <main className="home"><p className="muted">Opening project…</p></main>;
  return <WriterInner {...loaded} />;
}

function insertedChars(tr: Transaction): number {
  let n = 0;
  for (const step of tr.steps) {
    const slice = (step as unknown as { slice?: { content: PMNode["content"] } }).slice;
    if (slice) n += slice.content.textBetween(0, slice.content.size, "\n").length;
  }
  return n;
}

function WriterInner({ project: initial, doc, seq: initialSeq, failures }: { project: Project; doc: PMNode; seq: number; failures: number }) {
  const project = useRef<Project>(initial);
  const [title, setTitle] = useState(initial.title);
  const [words, setWords] = useState(initial.wordCount);
  const [privateMode, setPrivateMode] = useState(false);
  const [coachOn, setCoachOn] = useState(course.aiAvailable && course.aiOnByDefault);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");

  // ---- Recorder ----
  const buffer = useRef<RecEvent[]>([]);
  const seq = useRef(initialSeq);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const privateRef = useRef(false);
  const privateDirty = useRef(false);
  const editorRef = useRef<Editor | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    chain.current = chain.current.then(async () => {
      const batch = buffer.current;
      buffer.current = [];
      const ed = editorRef.current;
      try {
        if (batch.length) {
          await appendEvents(project.current.id, seq.current, batch);
          seq.current += batch.length;
        }
        if (ed) {
          project.current = {
            ...project.current,
            doc: ed.getJSON() as Record<string, unknown>,
            wordCount: wordCount(ed.getText()),
            eventCount: seq.current,
            updatedAt: Date.now(),
          };
        }
        await putProject(project.current);
        setSaveState("saved");
      } catch (e) {
        console.error(e);
        buffer.current = [...batch, ...buffer.current];
        setSaveState("error");
      }
    });
    return chain.current;
  }, []);

  const record = useCallback(
    (e: RecEvent) => {
      buffer.current.push(e);
      setSaveState("saving");
      if (!timer.current) timer.current = setTimeout(flush, 1200);
    },
    [flush],
  );

  const editor = useEditor({
    extensions: [...schemaExtensions, Placeholder.configure({ placeholder: "Start writing. Your process is being recorded for your own reflection." })],
    content: doc.toJSON(),
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    onTransaction: ({ transaction, editor: ed }) => {
      if (!transaction.docChanged) return;
      setWords(wordCount(ed.getText()));
      if (privateRef.current) {
        privateDirty.current = true;
        setSaveState("saving");
        if (!timer.current) timer.current = setTimeout(flush, 1200);
        return;
      }
      const ui = transaction.getMeta("uiEvent") as "paste" | "cut" | "drop" | undefined;
      record({
        type: "steps",
        t: Date.now(),
        steps: transaction.steps.map((s) => s.toJSON() as Record<string, unknown>),
        ...(ui ? { ui } : {}),
        inserted: insertedChars(transaction),
      });
    },
  });

  // Session start, and a consistency check between the log and the editor.
  useEffect(() => {
    if (!editor) return;
    editorRef.current = editor;
    record({ type: "session", t: Date.now() });
    if (failures > 0 || !editor.state.doc.eq(doc)) {
      record({ type: "reset", t: Date.now(), doc: editor.getJSON() as Record<string, unknown>, reason: "repair" });
    }
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  function togglePrivate() {
    const next = !privateRef.current;
    if (!next && privateDirty.current && editorRef.current) {
      // Leaving private mode: store the result as a single jump in the timeline.
      record({ type: "reset", t: Date.now(), doc: editorRef.current.getJSON() as Record<string, unknown>, reason: "private" });
      privateDirty.current = false;
    }
    privateRef.current = next;
    setPrivateMode(next);
  }

  function saveTitle(t: string) {
    project.current = { ...project.current, title: t.trim() || "Untitled project" };
    flush();
  }

  const logExchange = useCallback((e: Omit<AiEvent, "type" | "t">) => record({ type: "ai", t: Date.now(), ...e }), [record]);

  const getExcerpt = useCallback((scope: "selection" | "paragraph" | "draft"): string => {
    const ed = editorRef.current;
    if (!ed) return "";
    const { from, to, $from } = ed.state.selection;
    if (scope === "selection") return from === to ? "" : ed.state.doc.textBetween(from, to, "\n");
    if (scope === "paragraph") return $from.parent.textContent;
    return ed.getText().slice(0, course.maxExcerptChars);
  }, []);

  async function onExport() {
    await flush();
    const name = prompt("Your name (included in the file so your instructor knows whose it is):", project.current.author || "");
    if (name === null) return;
    project.current = { ...project.current, author: name.trim() };
    await flush();
    downloadBlob(await exportProject(project.current.id, name.trim()), `${safeFilename(project.current.title)}.rsproj.json`);
  }

  const tb = (label: string, action: () => void, active?: boolean, titleText?: string) => (
    <button className={active ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onClick={action} title={titleText || label}>
      {label}
    </button>
  );

  return (
    <>
      <div className="topbar">
        <Link href="/" className="brand">Research Suite</Link>
        <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={(e) => saveTitle(e.target.value)} aria-label="Project title" />
        <span className={`rec ${privateMode ? "paused" : ""}`} title={privateMode ? "Not recording keystrokes. The result will appear as one jump in your replay." : "Your writing process is being recorded"}>
          <span className="dot" /> {privateMode ? "Private writing" : "Recording"}
        </span>
        <span className="muted small">{words} words · {saveState === "saving" ? "Saving…" : saveState === "error" ? "Couldn't save!" : "Saved"}</span>
        <span className="spacer" />
        <button onClick={togglePrivate} className={privateMode ? "on" : ""} title="Pause detailed recording. The replay will show that private writing happened here.">
          {privateMode ? "Resume recording" : "Private mode"}
        </button>
        {course.aiAvailable && (
          <button onClick={() => setCoachOn((v) => !v)} className={coachOn ? "on" : ""}>
            AI coach: {coachOn ? "On" : "Off"}
          </button>
        )}
        <Link href={`/replay/${initial.id}`} onClick={() => flush()}><button>Replay &amp; reflect</button></Link>
        <button onClick={onExport}>Export</button>
        <button onClick={() => window.print()} title="Print or save as PDF">Print</button>
      </div>
      <div className={`workspace ${coachOn ? "with-coach" : ""}`}>
        <div className="paper-wrap">
          {editor && (
            <div className="toolbar">
              {tb("B", () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"), "Bold")}
              {tb("I", () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"), "Italic")}
              {tb("U", () => editor.chain().focus().toggleUnderline().run(), editor.isActive("underline"), "Underline")}
              {tb("H1", () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive("heading", { level: 1 }), "Title")}
              {tb("H2", () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }), "Section heading")}
              {tb("• List", () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
              {tb("1. List", () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
              {tb("❝ Quote", () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"), "Block quotation")}
              {tb("↶", () => editor.chain().focus().undo().run(), false, "Undo")}
              {tb("↷", () => editor.chain().focus().redo().run(), false, "Redo")}
            </div>
          )}
          <div className="paper">
            <EditorContent editor={editor} />
          </div>
        </div>
        {coachOn && <CoachPanel getExcerpt={getExcerpt} onExchange={logExchange} />}
      </div>
    </>
  );
}
