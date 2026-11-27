"use client";
// The writing screen: editor + process recorder + coach panel.
import Placeholder from "@tiptap/extension-placeholder";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { course } from "@/config/course";
import { ReplayEngine, wordCount } from "@/lib/replay";
import { getDocSchema, schemaExtensions } from "@/lib/schema";
import { currentAccount, type Account } from "@/lib/cloud";
import { pullProject, pushProject } from "@/lib/sync";
import { MERGE_GAP_MS, mergeTyping, startTyping, stepsToJSON, type PendingTyping } from "@/lib/compact";
import { appendEvents, getEvents, getEventsFrom, getProject, latestSnapshot, putProject, putSnapshot } from "@/lib/store";
import type { AiEvent, Project, RecEvent } from "@/lib/types";
import CoachPanel from "./CoachPanel";
import DownloadMenu from "./DownloadMenu";
import TurnInButton from "./TurnInButton";

export default function Writer({ projectId }: { projectId: string }) {
  const [loaded, setLoaded] = useState<{ project: Project; doc: PMNode; seq: number; snapSeq: number; failures: number; account: Account | null } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const account = await currentAccount();
      let project = await getProject(projectId);
      if (!project) return setError("Project not found on this device.");
      if (project.imported) return setError("This is a shared recording. It can be replayed but not edited.");
      if (project.owner && project.owner !== account?.id) return setError("This project belongs to another account. Sign in to that account to open it.");
      if (account && project.owner === account.id) {
        // Bring in anything written on another computer (but don't wait forever if offline).
        await Promise.race([pullProject(projectId, account).catch(() => {}), new Promise((r) => setTimeout(r, 6000))]);
        project = (await getProject(projectId)) ?? project;
      }
      const schema = getDocSchema();
      // Open from the latest snapshot and replay only what came after it.
      const snap = await latestSnapshot(projectId);
      if (snap) {
        try {
          const base = schema.nodeFromJSON(snap.doc);
          const tail = await getEventsFrom(projectId, snap.seq);
          const engine = new ReplayEngine(schema, tail, 200, base);
          const doc = engine.final();
          return setLoaded({ project, doc, seq: snap.seq + tail.length, snapSeq: snap.seq, failures: engine.failures, account });
        } catch (e) {
          console.warn("Snapshot unusable; replaying the full recording", e);
        }
      }
      const events = await getEvents(projectId);
      const engine = new ReplayEngine(schema, events);
      const doc = engine.final();
      setLoaded({ project, doc, seq: events.length, snapSeq: 0, failures: engine.failures, account });
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

/** Save a snapshot of the document after this many new events. */
const SNAPSHOT_EVERY = 400;

type Entry = { e: RecEvent; doc: PMNode };

function WriterInner({
  project: initial,
  doc,
  seq: initialSeq,
  snapSeq,
  failures,
  account,
}: {
  project: Project;
  doc: PMNode;
  seq: number;
  snapSeq: number;
  failures: number;
  account: Account | null;
}) {
  const project = useRef<Project>(initial);
  const [title, setTitle] = useState(initial.title);
  const [words, setWords] = useState(initial.wordCount);
  const [coachOn, setCoachOn] = useState(course.aiAvailable && course.aiOnByDefault);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [cloudState, setCloudState] = useState<"off" | "synced" | "pending" | "offline">(account ? "synced" : "off");

  // ---- Cloud upload (background, every few seconds while writing) ----
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushNow = useCallback(() => {
    if (!account) return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = null;
    pushProject(initial.id, account)
      .then(() => setCloudState((s) => (s === "pending" && pushTimer.current ? s : "synced")))
      .catch(() => setCloudState("offline"));
  }, [account, initial.id]);
  const pushSoon = useCallback(() => {
    if (!account) return;
    setCloudState((s) => (s === "offline" ? s : "pending"));
    if (!pushTimer.current) pushTimer.current = setTimeout(pushNow, 8000);
  }, [account, pushNow]);
  const pushSoonRef = useRef(pushSoon);
  pushSoonRef.current = pushSoon;

  // ---- Recorder ----
  // Finished events wait in `buffer` until they are written to storage. Plain
  // typing collects in `pending` and becomes one event per word. Each entry
  // keeps the document as it stood after that event, for snapshots.
  const buffer = useRef<Entry[]>([]);
  const pending = useRef<{ typing: PendingTyping; doc: PMNode } | null>(null);
  const loggedDoc = useRef<PMNode>(doc); // the document the recording describes so far
  const seq = useRef(initialSeq);
  const lastSnap = useRef(snapSeq);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  // Latest document, kept outside the editor so saving still works after it closes.
  const latestDoc = useRef<PMNode | null>(null);

  /** Something typed or recorded hasn't reached storage yet. */
  const unsaved = useRef(false);

  const closePending = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    buffer.current.push({ e: { type: "steps", t: p.typing.t, steps: stepsToJSON(p.typing.steps), inserted: p.typing.inserted }, doc: p.doc });
  }, []);

  const schedule = useRef<() => void>(() => {});
  const saveInRef = useRef<(delay: number) => void>(() => {});

  /** Write recorded events to storage. `force` also closes the word being typed. */
  const flush = useCallback(
    (force = false) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (pending.current && (force || Date.now() - pending.current.typing.t > MERGE_GAP_MS)) closePending();
      chain.current = chain.current.then(async () => {
        const batch = buffer.current;
        buffer.current = [];
        try {
          if (batch.length) {
            await appendEvents(project.current.id, seq.current, batch.map((b) => b.e));
            seq.current += batch.length;
            const after = batch[batch.length - 1].doc;
            if (seq.current - lastSnap.current >= SNAPSHOT_EVERY || (force && seq.current > lastSnap.current)) {
              await putSnapshot(project.current.id, seq.current, after.toJSON() as Record<string, unknown>);
              lastSnap.current = seq.current;
            }
          }
          // Save the word still being typed in the next slot. If more letters
          // are added, the same slot is overwritten, so nothing is lost if the
          // page closes mid-word.
          const p = pending.current;
          if (p) {
            await appendEvents(project.current.id, seq.current, [
              { type: "steps", t: p.typing.t, steps: stepsToJSON(p.typing.steps), inserted: p.typing.inserted },
            ]);
          }
          const stored = await getProject(project.current.id);
          if (stored) project.current = { ...stored, title: project.current.title };
          const latest = latestDoc.current;
          if (latest) {
            project.current = {
              ...project.current,
              doc: latest.toJSON() as Record<string, unknown>,
              wordCount: wordCount(latest.textBetween(0, latest.content.size, "\n", " ")),
              eventCount: seq.current,
              updatedAt: Date.now(),
            };
          }
          await putProject(project.current);
          pushSoonRef.current();
          unsaved.current = buffer.current.length > 0;
          setSaveState(buffer.current.length ? "saving" : "saved");
        } catch (e) {
          console.error(e);
          buffer.current = [...batch, ...buffer.current];
          setSaveState("error");
        }
        if (buffer.current.length) schedule.current();
        // Close the word once typing pauses, so it becomes a finished event.
        else if (pending.current) saveInRef.current(MERGE_GAP_MS + 100);
      });
      return chain.current;
    },
    [closePending],
  );
  const timerDue = useRef(0);
  /** Run a save at `delay` ms from now, unless one is already due sooner. */
  const saveIn = useCallback(
    (delay: number) => {
      const due = Date.now() + delay;
      if (timer.current && timerDue.current <= due) return;
      if (timer.current) clearTimeout(timer.current);
      timerDue.current = due;
      timer.current = setTimeout(() => flush(), delay);
    },
    [flush],
  );
  saveInRef.current = saveIn;
  schedule.current = () => {
    unsaved.current = true;
    saveIn(400);
  };
  const flushAll = useCallback(() => flush(true), [flush]);

  /** Record a finished event; `after` is the document once it has happened. */
  const record = useCallback(
    (e: RecEvent, after?: PMNode) => {
      closePending();
      if (after) loggedDoc.current = after;
      buffer.current.push({ e, doc: loggedDoc.current });
      // A "session started" marker alone isn't worth a leave-page warning.
      if (e.type === "session") saveInRef.current(400);
      else {
        setSaveState("saving");
        schedule.current();
      }
    },
    [closePending],
  );

  const editor = useEditor({
    extensions: [...schemaExtensions, Placeholder.configure({ placeholder: "Start writing. Your process is being recorded for your own reflection." })],
    content: doc.toJSON(),
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    onTransaction: ({ transaction, editor: ed }) => {
      if (!transaction.docChanged) return;
      latestDoc.current = transaction.doc;
      setWords(wordCount(ed.getText()));
      const ui = transaction.getMeta("uiEvent") as "paste" | "cut" | "drop" | undefined;
      const now = Date.now();
      const inserted = insertedChars(transaction);
      if (ui) {
        record({ type: "steps", t: now, steps: stepsToJSON(transaction.steps), ui, inserted }, transaction.doc);
        return;
      }
      // Plain typing: fold into the current word when possible.
      const p = pending.current;
      if (p && mergeTyping(p.typing, now, transaction.steps, inserted)) {
        p.doc = transaction.doc;
      } else {
        closePending();
        pending.current = { typing: startTyping(now, transaction.steps, inserted), doc: transaction.doc };
      }
      loggedDoc.current = transaction.doc;
      setSaveState("saving");
      schedule.current();
    },
  });

  // Session start, and a consistency check between the log and the editor.
  useEffect(() => {
    if (!editor) return;
    editorRef.current = editor;
    record({ type: "session", t: Date.now() });
    // Compare content, not objects: the editor builds its own copy of the schema.
    if (failures > 0 || JSON.stringify(editor.state.doc.toJSON()) !== JSON.stringify(doc.toJSON())) {
      record({ type: "reset", t: Date.now(), doc: editor.getJSON() as Record<string, unknown>, reason: "repair" }, editor.state.doc);
    }
    const onHide = () => {
      if (document.visibilityState === "hidden") flushAll().then(() => pushNow());
    };
    // If the page is closed in the split second before a save finishes, ask first.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!unsaved.current) return;
      flushAll();
      e.preventDefault();
      e.returnValue = "";
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushAll);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushAll);
      window.removeEventListener("beforeunload", onBeforeUnload);
      flushAll().then(() => pushNow());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

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
        <span className="rec" title="Your writing process is being recorded for your replay">
          <span className="dot" /> Recording
        </span>
        <span className="muted small">{words} words · {saveState === "saving" ? "Saving…" : saveState === "error" ? "Couldn't save!" : "Saved"}</span>
        <span className={`cloud-status ${cloudState === "off" || cloudState === "offline" ? "off" : ""}`} title={account ? `Signed in as ${account.email}` : "Sign in on the home page to save to your account"}>
          {cloudState === "off" ? "· This computer only" : cloudState === "offline" ? "· Offline: will sync later" : cloudState === "pending" ? "· Syncing…" : "· In your account"}
        </span>
        <span className="spacer" />
        {course.aiAvailable && (
          <button onClick={() => setCoachOn((v) => !v)} className={coachOn ? "on" : ""}>
            AI coach: {coachOn ? "On" : "Off"}
          </button>
        )}
        <Link href={`/replay/${initial.id}`} onClick={() => flushAll()}><button>Replay &amp; reflect</button></Link>
        <TurnInButton projectId={initial.id} beforeTurnIn={flushAll} />
        <DownloadMenu projectId={initial.id} beforeExport={flushAll} />
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
