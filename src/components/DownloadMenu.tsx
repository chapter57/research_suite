"use client";
import { useEffect, useRef, useState } from "react";
import { packs } from "@/lib/coach/packs";
import { course } from "@/config/course";
import { downloadBlob, safeFilename } from "@/lib/download";
import { buildPaper, mlaDate, type MlaInfo } from "@/lib/paperModel";
import { exportProject, getProject, putProject } from "@/lib/store";
import { exportReplayVideo, pickVideoFormat } from "@/lib/videoExport";

export default function DownloadMenu({ projectId, beforeExport }: { projectId: string; beforeExport?: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Download</button>
      {open && <DownloadDialog projectId={projectId} beforeExport={beforeExport} onClose={() => setOpen(false)} />}
    </>
  );
}

function DownloadDialog({ projectId, beforeExport, onClose }: { projectId: string; beforeExport?: () => Promise<void>; onClose: () => void }) {
  const [info, setInfo] = useState<MlaInfo>({ name: "", instructor: "", course: packs[course.packId]?.course ?? "", date: mlaDate() });
  const [useMla, setUseMla] = useState(true);
  const [readOnly, setReadOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [video, setVideo] = useState<{ fraction: number; label: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    getProject(projectId).then((p) => {
      if (!p) return;
      setReadOnly(!!p.imported);
      setInfo((i) => ({ ...i, ...(p.mla ?? {}), name: p.mla?.name || p.author || "", date: mlaDate() }));
    });
  }, [projectId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function saveInfo() {
    await beforeExport?.();
    const p = await getProject(projectId);
    if (!p) throw new Error("Project not found.");
    if (!p.imported) {
      const updated = { ...p, mla: info, author: info.name.trim() || p.author };
      await putProject(updated);
      return updated;
    }
    return p;
  }

  async function run(label: string, fn: () => Promise<void>) {
    setError("");
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      if ((e as DOMException)?.name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const paper = (kind: "docx" | "pdf") =>
    run(kind, async () => {
      const p = await saveInfo();
      const built = buildPaper(p.doc, p.title, useMla ? info : null);
      const { paperToDocx, paperToPdf } = await import("@/lib/paperExport");
      const blob = kind === "docx" ? await paperToDocx(built) : await paperToPdf(built);
      downloadBlob(blob, `${safeFilename(built.title)}.${kind}`);
    });

  const projectFile = () =>
    run("file", async () => {
      const p = await saveInfo();
      downloadBlob(await exportProject(projectId, info.name.trim() || p.author), `${safeFilename(p.title)}.rsproj.json`);
    });

  const makeVideo = () =>
    run("video", async () => {
      const p = await saveInfo();
      const ac = new AbortController();
      abortRef.current = ac;
      setVideo({ fraction: 0, label: "Starting…" });
      try {
        const { blob, ext } = await exportReplayVideo(projectId, canvasRef.current!, { signal: ac.signal, onProgress: setVideo });
        downloadBlob(blob, `${safeFilename(p.title)}-process.${ext}`);
      } finally {
        setVideo(null);
        abortRef.current = null;
      }
    });

  const canVideo = typeof window !== "undefined" && !!pickVideoFormat();
  const field = (key: keyof MlaInfo, label: string, placeholder = "") => (
    <label className="field">
      <span>{label}</span>
      <input type="text" value={info[key]} placeholder={placeholder} disabled={readOnly} onChange={(e) => setInfo({ ...info, [key]: e.target.value })} />
    </label>
  );

  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && !video && onClose()}>
      <div className="modal" role="dialog" aria-label="Download">
        <div className="row">
          <h2 style={{ margin: 0 }}>Download</h2>
          <span className="spacer" />
          {!video && <button className="ghost" onClick={onClose} aria-label="Close">✕</button>}
        </div>

        <section style={{ display: video ? "none" : "block" }}>
          <h3>Your paper</h3>
          <div className="fields">
            {field("name", "Your name", "First Last")}
            {field("instructor", "Instructor", "Professor Smith")}
            {field("course", "Course")}
            {field("date", "Date")}
          </div>
          <label className="small row" style={{ gap: 6, marginTop: 8 }}>
            <input type="checkbox" checked={useMla} onChange={(e) => setUseMla(e.target.checked)} />
            Format in MLA style (heading, page numbers, double spacing, Works Cited on its own page)
          </label>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" onClick={() => paper("docx")} disabled={!!busy || (useMla && !info.name.trim())}>Word (.docx)</button>
            <button className="primary" onClick={() => paper("pdf")} disabled={!!busy || (useMla && !info.name.trim())}>PDF</button>
            {useMla && !info.name.trim() && <span className="small muted">Add your name for the MLA heading.</span>}
          </div>
          <p className="small muted">Tip: start a line with the heading “Works Cited” and your sources will be put on a new page with hanging indents.</p>
        </section>

        <section style={{ display: video ? "none" : "block" }}>
          <h3>Your writing process</h3>
          <div className="choice">
            <div>
              <b>Replay video</b>
              <div className="small muted">A video of your paper being written, with your reflections and voice notes. Takes about 2–3 minutes to make; keep this tab open.</div>
            </div>
            <button onClick={makeVideo} disabled={!!busy || !canVideo}>{canVideo ? "Make video" : "Not supported here"}</button>
          </div>
          <div className="choice">
            <div>
              <b>Project file</b>
              <div className="small muted">The full interactive replay. Upload this to Moodle; your instructor opens it in Research Suite.</div>
            </div>
            <button onClick={projectFile} disabled={!!busy}>Download file</button>
          </div>
        </section>

        <section style={{ display: video ? "block" : "none" }}>
          <h3>Making your replay video…</h3>
          <canvas ref={canvasRef} className="video-preview" />
          <div className="progress"><div style={{ width: `${Math.round((video?.fraction ?? 0) * 100)}%` }} /></div>
          <div className="row small muted">
            <span>{video?.label} {Math.round((video?.fraction ?? 0) * 100)}%</span>
            <span className="spacer" />
            <button onClick={() => abortRef.current?.abort()}>Cancel</button>
          </div>
          <p className="small muted">Keep this tab open and visible until it finishes.</p>
        </section>

        {busy && busy !== "video" && <p className="small muted">Preparing your file…</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
