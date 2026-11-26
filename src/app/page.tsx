"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createProject, deleteProject, importProject, listProjects } from "@/lib/store";
import type { Project } from "@/lib/types";

export default function Home() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => listProjects().then(setProjects).catch((e) => setError(String(e)));
  useEffect(() => {
    refresh();
  }, []);

  async function onNew() {
    const title = prompt("Name your project", "Untitled project");
    if (title === null) return;
    const p = await createProject(title.trim() || "Untitled project");
    router.push(`/write/${p.id}`);
  }

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const p = await importProject(f);
      router.push(`/replay/${p.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onDelete(p: Project) {
    if (!confirm(`Delete "${p.title}" and its whole recording? This can't be undone.`)) return;
    await deleteProject(p.id);
    refresh();
  }

  return (
    <main className="home">
      <h1>Research Suite</h1>
      <p className="muted">Write your project, and the studio quietly records how it takes shape. Afterward, replay your process and talk through your thinking.</p>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="primary" onClick={onNew}>New project</button>
        <button onClick={() => fileRef.current?.click()}>Open a shared recording…</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onImport} />
      </div>
      {error && <p className="error">{error}</p>}

      <div className="cards">
        {projects === null && <p className="muted">Loading…</p>}
        {projects?.length === 0 && <p className="muted">No projects yet. Start one above.</p>}
        {projects?.map((p) => (
          <div className="card row" key={p.id}>
            <div>
              <h3>
                {p.imported ? <Link href={`/replay/${p.id}`}>{p.title}</Link> : <Link href={`/write/${p.id}`}>{p.title}</Link>}
              </h3>
              <div className="muted small">
                {p.imported ? `Shared recording${p.author ? ` from ${p.author}` : ""} · ` : ""}
                {p.wordCount} words · edited {new Date(p.updatedAt).toLocaleString()}
              </div>
            </div>
            <span className="spacer" />
            {!p.imported && <Link href={`/write/${p.id}`}><button>Write</button></Link>}
            <Link href={`/replay/${p.id}`}><button>Replay</button></Link>
            <button className="ghost" onClick={() => onDelete(p)} title="Delete project">Delete</button>
          </div>
        ))}
      </div>

      <div className="explain">
        <div className="card">
          <h3>Your words, your process</h3>
          <p className="small muted">Every keystroke, paste and revision is saved as a timeline, so you can watch your paper grow from first word to final draft.</p>
        </div>
        <div className="card">
          <h3>A coach, not a ghostwriter</h3>
          <p className="small muted">Switch on the AI coach for questions, reader reactions, skill lessons and research help. It never writes your paper, and conversations are kept in your recording.</p>
        </div>
        <div className="card">
          <h3>Reflect out loud</h3>
          <p className="small muted">Replay your process and pin voice or text notes to key moments. Export the file to turn it in on Moodle.</p>
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 24 }}>
        Your projects are stored in this browser on this device. Use <b>Export</b> to back up a project or submit it.
      </p>
    </main>
  );
}
