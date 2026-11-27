"use client";
// Replay & reflect: plays back the writing process and lets the writer pin
// voice or text reflections to moments in it.
import { EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { modeById, type ModeId } from "@/lib/coach/modes";
import { buildTimeline, computeStats, countAtTime, formatDuration, ReplayEngine } from "@/lib/replay";
import { getDocSchema } from "@/lib/schema";
import { deleteReflection, getEvents, getSnapshots, getProject, getReflections, newId, putReflection } from "@/lib/store";
import type { AiEvent, Project, RecEvent, Reflection } from "@/lib/types";
import DownloadMenu from "./DownloadMenu";
import TurnInButton from "./TurnInButton";
import { currentAccount, type Account } from "@/lib/cloud";
import { deleteReflectionFromCloud, pullProject, pushProject } from "@/lib/sync";

const SPEEDS = [1, 2, 4, 8, 16, 32];

// The signed-in account (if any), for uploading reflections.
const accountRef: { current: Account | null } = { current: null };

function upload(projectId: string) {
  const a = accountRef.current;
  if (a) pushProject(projectId, a).catch(() => {});
}

export default function Player({ projectId }: { projectId: string }) {
  const [data, setData] = useState<{ project: Project; events: RecEvent[]; reflections: Reflection[]; snapshots: { seq: number; doc: Record<string, unknown> }[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    (async () => {
      const account = await currentAccount();
      let project = await getProject(projectId);
      if (!project) return setError("Project not found on this device.");
      if (project.owner && project.owner !== account?.id) return setError("This project belongs to another account. Sign in to that account to open it.");
      if (account && project.owner === account.id) {
        await Promise.race([pullProject(projectId, account).catch(() => {}), new Promise((r) => setTimeout(r, 6000))]);
        project = (await getProject(projectId)) ?? project;
      }
      accountRef.current = account;
      const [events, reflections, snapshots] = await Promise.all([getEvents(projectId), getReflections(projectId), getSnapshots(projectId)]);
      setData({ project, events, reflections, snapshots });
    })().catch((e) => setError(String(e)));
  }, [projectId]);
  if (error) return <main className="home"><p className="error">{error}</p><Link href="/">Back to projects</Link></main>;
  if (!data) return <main className="home"><p className="muted">Loading recording…</p></main>;
  return <PlayerInner {...data} />;
}

function fmtClock(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function PlayerInner({
  project,
  events,
  reflections: initialRefs,
  snapshots,
  review,
}: {
  project: Project;
  events: RecEvent[];
  reflections: Reflection[];
  snapshots: { seq: number; doc: Record<string, unknown> }[];
  /** Instructor reviewing turned-in work: read-only, loaded from the cloud. */
  review?: { banner: React.ReactNode; backHref: string };
}) {
  const schema = getDocSchema();
  const engine = useMemo(() => {
    const e = new ReplayEngine(schema, events);
    for (const s of snapshots) {
      if (s.seq > events.length) continue;
      try {
        e.seed(s.seq, schema.nodeFromJSON(s.doc));
      } catch {
        /* ignore an unreadable snapshot; the engine replays instead */
      }
    }
    return e;
  }, [schema, events, snapshots]);
  const timeline = useMemo(() => buildTimeline(events), [events]);
  const stats = useMemo(() => computeStats(events), [events]);
  const readOnly = !!project.imported || !!review;

  // Session number for each event index.
  const sessionOf = useMemo(() => {
    let n = 0;
    return events.map((e) => (e.type === "session" ? ++n : n));
  }, [events]);
  const aiIdx = useMemo(() => events.flatMap((e, i) => (e.type === "ai" ? [i] : [])), [events]);

  const [refs, setRefs] = useState(initialRefs);
  const [pos, setPos] = useState(timeline.total);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [pauseAtNotes, setPauseAtNotes] = useState(true);
  const [activeNote, setActiveNote] = useState<string | null>(null);

  const posRef = useRef(pos);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const pauseRef = useRef(pauseAtNotes);
  pauseRef.current = pauseAtNotes;
  const refsRef = useRef(refs);
  refsRef.current = refs;

  const count = countAtTime(timeline.times, pos);
  const anchorTime = (at: number) => (at <= 0 ? 0 : timeline.times[at - 1]);

  const audioUrls = useMemo(() => {
    const m = new Map<string, string>();
    refs.forEach((r) => r.audio && m.set(r.id, URL.createObjectURL(r.audio)));
    return m;
  }, [refs]);
  useEffect(() => () => audioUrls.forEach((u) => URL.revokeObjectURL(u)), [audioUrls]);

  // ---- Document view ----
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const decoRef = useRef<DecorationSet>(DecorationSet.empty);
  useEffect(() => {
    if (!mountRef.current) return;
    const view = new EditorView(mountRef.current, {
      state: EditorState.create({ schema }),
      editable: () => false,
      decorations: () => decoRef.current,
    });
    viewRef.current = view;
    return () => view.destroy();
  }, [schema]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const { doc, range } = engine.frameAt(count);
    const decos: Decoration[] = [];
    if (range) {
      const max = doc.content.size;
      const from = Math.max(0, Math.min(range.from, max));
      const to = Math.max(from, Math.min(range.to, max));
      if (to > from) decos.push(Decoration.inline(from, to, { class: "fresh" }));
      else
        decos.push(
          Decoration.widget(from, () => {
            const s = document.createElement("span");
            s.className = "caret";
            return s;
          }),
        );
    }
    decoRef.current = DecorationSet.create(doc, decos);
    view.updateState(EditorState.create({ schema, doc }));
    if (range && playing) {
      try {
        const { node } = view.domAtPos(Math.min(range.from, doc.content.size));
        const el = node.nodeType === 3 ? node.parentElement : (node as HTMLElement);
        el?.scrollIntoView({ block: "nearest" });
      } catch {
        /* position not rendered */
      }
    }
  }, [count, engine, schema, playing]);

  // ---- Playback loop ----
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = posRef.current;
      let np = Math.min(timeline.total, p + (now - last) * speedRef.current);
      last = now;
      let stopAt: Reflection | null = null;
      if (pauseRef.current) {
        for (const r of refsRef.current) {
          const at = anchorTime(r.at);
          if (at > p && at <= np) {
            stopAt = r;
            np = at;
            break;
          }
        }
      }
      posRef.current = np;
      setPos(np);
      if (stopAt) {
        setPlaying(false);
        setActiveNote(stopAt.id);
        const url = audioUrls.get(stopAt.id);
        if (url) {
          const a = new Audio(url);
          a.onended = () => setPlaying(true);
          a.play().catch(() => {});
        }
        return;
      }
      if (np >= timeline.total) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, timeline, audioUrls]);

  function seek(ms: number) {
    posRef.current = ms;
    setPos(ms);
    setActiveNote(null);
  }
  function togglePlay() {
    if (!playing && posRef.current >= timeline.total) seek(0);
    setActiveNote(null);
    setPlaying((v) => !v);
  }

  // ---- Reflections ----
  const [noteText, setNoteText] = useState("");
  const [recording, setRecording] = useState<{ rec: MediaRecorder; started: number } | null>(null);
  const [micError, setMicError] = useState("");

  async function addTextNote() {
    if (!noteText.trim()) return;
    const r: Reflection = { id: newId(), projectId: project.id, at: count, kind: "text", text: noteText.trim(), createdAt: Date.now() };
    await putReflection(r);
    upload(project.id);
    setRefs((rs) => [...rs, r].sort((a, b) => a.at - b.at));
    setNoteText("");
  }

  async function startVoice() {
    setMicError("");
    setPlaying(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const at = count;
      const started = Date.now();
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const audio = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        const r: Reflection = {
          id: newId(), projectId: project.id, at, kind: "audio", audio,
          text: noteText.trim() || undefined, durationMs: Date.now() - started, createdAt: Date.now(),
        };
        await putReflection(r);
        upload(project.id);
        setRefs((rs) => [...rs, r].sort((a, b) => a.at - b.at));
        setNoteText("");
      };
      rec.start();
      setRecording({ rec, started });
    } catch {
      setMicError("Couldn't use the microphone. Check your browser's permission settings.");
    }
  }
  function stopVoice() {
    recording?.rec.stop();
    setRecording(null);
  }
  async function removeNote(id: string) {
    if (!confirm("Delete this reflection?")) return;
    await deleteReflection(id);
    if (accountRef.current && project.owner === accountRef.current.id) deleteReflectionFromCloud(id).catch(() => {});
    setRefs((rs) => rs.filter((r) => r.id !== id));
  }

  // ---- Derived display ----
  const moment = count > 0 ? events[count - 1] : null;
  const lastAi = [...aiIdx].reverse().find((i) => i < count);
  const lastAiEvent = lastAi !== undefined ? (events[lastAi] as AiEvent) : null;
  const total = timeline.total || 1;
  const pct = (ms: number) => `${(ms / total) * 100}%`;
  const markers = useMemo(
    () =>
      events.flatMap((e, i) => {
        if (e.type === "session" && i > 0) return [{ k: `s${i}`, cls: "session", t: timeline.times[i] }];
        if (e.type === "ai") return [{ k: `a${i}`, cls: "ai", t: timeline.times[i] }];
        if (e.type === "reset" && e.reason === "private") return [{ k: `r${i}`, cls: "private", t: timeline.times[i] }];
        if (e.type === "steps" && (e.ui === "paste" || e.ui === "drop") && (e.inserted ?? 0) > 20) return [{ k: `p${i}`, cls: "paste", t: timeline.times[i] }];
        return [];
      }),
    [events, timeline],
  );

  return (
    <>
      <div className="topbar">
        <Link href="/" className="brand">Research Suite</Link>
        <strong>{project.title}</strong>
        <span className="muted small">Replay &amp; reflect</span>
        <span className="spacer" />
        {!readOnly && <Link href={`/write/${project.id}`}><button>Back to writing</button></Link>}
        {!readOnly && <TurnInButton projectId={project.id} />}
        {review ? <Link href={review.backHref}><button>Back to class</button></Link> : <DownloadMenu projectId={project.id} />}
      </div>
      {review ? (
        <div className="banner">{review.banner}</div>
      ) : (
        readOnly && (
          <div className="banner">
            Viewing a shared recording{project.author ? ` from ${project.author}` : ""}. Reflections are shown as the writer recorded them.
          </div>
        )
      )}
      <div className="replay">
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div className="paper-wrap" style={{ flex: 1 }}>
            {events.length === 0 ? (
              <p className="muted" style={{ textAlign: "center" }}>Nothing recorded yet. Write something first, then come back to replay it.</p>
            ) : (
              <div className="paper"><div ref={mountRef} /></div>
            )}
          </div>
          {events.length > 0 && (
            <div className="controls">
              <div className="scrub">
                {markers.map((m) => <span key={m.k} className={`marker ${m.cls}`} style={{ left: pct(m.t) }} />)}
                {refs.map((r) => <span key={r.id} className="marker note" style={{ left: pct(anchorTime(r.at)) }} />)}
                <input type="range" min={0} max={timeline.total} step="any" value={pos} onChange={(e) => seek(Number(e.target.value))} aria-label="Timeline" />
              </div>
              <div className="row">
                <button className="primary" onClick={togglePlay} style={{ minWidth: 80 }}>{playing ? "Pause" : "Play"}</button>
                <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Speed">
                  {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
                </select>
                <span className="small muted">
                  {fmtClock(pos / speed)} / {fmtClock(timeline.total / speed)}
                  {moment && <> · Session {sessionOf[count - 1]} · {new Date(moment.t).toLocaleString()}</>}
                </span>
                <span className="spacer" />
                <label className="small row" style={{ gap: 4 }}>
                  <input type="checkbox" checked={pauseAtNotes} onChange={(e) => setPauseAtNotes(e.target.checked)} /> Stop at reflections
                </label>
              </div>
              <div className="legend">
                <span><i style={{ background: "var(--note)" }} />Reflection</span>
                <span><i style={{ background: "var(--coach)" }} />AI coach</span>
                <span><i style={{ background: "var(--paste)" }} />Paste</span>
                <span><i style={{ background: "var(--muted)" }} />New session</span>
                <span><i style={{ background: "var(--danger)" }} />Private writing</span>
              </div>
            </div>
          )}
        </div>

        <aside className="side">
          {!readOnly && events.length > 0 && (
            <section>
              <h2>Reflect on this moment</h2>
              <p className="small muted" style={{ marginTop: 0 }}>
                Pause where something interesting happened. What were you thinking? Why did you change it?
              </p>
              <textarea rows={3} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Type a reflection (or a caption for a voice note)…" />
              <div className="row" style={{ marginTop: 6 }}>
                <button onClick={addTextNote} disabled={!noteText.trim() || !!recording}>Pin text note</button>
                {recording ? (
                  <button className="on" onClick={stopVoice}>■ Stop recording</button>
                ) : (
                  <button onClick={startVoice}>● Record voice note</button>
                )}
              </div>
              {micError && <p className="error">{micError}</p>}
            </section>
          )}

          <section>
            <h2>Reflections ({refs.length})</h2>
            {refs.length === 0 && <p className="small muted">None yet.</p>}
            <div style={{ display: "grid", gap: 8 }}>
              {refs.map((r) => (
                <div key={r.id} className={`note-item ${activeNote === r.id ? "active" : ""}`}>
                  <div className="row small">
                    <button className="ghost small" onClick={() => seek(anchorTime(r.at))}>
                      ⏵ {r.at > 0 ? `Session ${sessionOf[r.at - 1]}, ${new Date(events[r.at - 1].t).toLocaleString()}` : "Start"}
                    </button>
                    <span className="spacer" />
                    {!readOnly && <button className="ghost small" onClick={() => removeNote(r.id)} aria-label="Delete reflection">✕</button>}
                  </div>
                  {r.text && <div style={{ whiteSpace: "pre-wrap" }}>{r.text}</div>}
                  {r.audio && <audio controls src={audioUrls.get(r.id)} />}
                </div>
              ))}
            </div>
          </section>

          {lastAiEvent && (
            <section>
              <h2>Latest coach exchange</h2>
              <div className="ai-card">
                <div className="small muted">{modeById[lastAiEvent.mode as ModeId]?.label ?? lastAiEvent.mode} · {new Date(lastAiEvent.t).toLocaleString()}</div>
                <p style={{ margin: "6px 0" }}><b>Asked:</b> {lastAiEvent.question}</p>
                <div><b>Coach:</b> {lastAiEvent.answer}</div>
              </div>
            </section>
          )}

          <section>
            <h2>Process at a glance</h2>
            <div className="stats">
              <div className="stat"><b>{stats.sessions}</b><span>writing sessions</span></div>
              <div className="stat"><b>{formatDuration(stats.activeMs)}</b><span>active writing time</span></div>
              <div className="stat"><b>{stats.typedChars.toLocaleString()}</b><span>characters typed</span></div>
              <div className="stat"><b>{stats.pastedChars.toLocaleString()}</b><span>characters pasted ({stats.pastes} pastes)</span></div>
              <div className="stat"><b>{stats.aiExchanges}</b><span>coach exchanges</span></div>
              <div className="stat"><b>{formatDuration(stats.spanMs)}</b><span>first to last edit</span></div>
            </div>
            {stats.privateGaps > 0 && <p className="small muted">Includes {stats.privateGaps} stretch(es) of private writing, shown as jumps.</p>}
          </section>
        </aside>
      </div>
    </>
  );
}
