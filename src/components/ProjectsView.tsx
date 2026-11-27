"use client";
// A person's own projects: new, open, replay, delete; syncs with their account.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Account, Role } from "@/lib/cloud";
import { createProject, deleteProject, importProject, listProjects } from "@/lib/store";
import { deleteFromCloud, syncAll, visibleTo } from "@/lib/sync";
import type { Project } from "@/lib/types";
import NewProjectDialog, { type NewProjectChoice } from "./NewProjectDialog";

export default function ProjectsView({ account, role, heading }: { account: Account | null; role?: Role; heading: string }) {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () =>
    listProjects()
      .then((all) => setProjects(all.filter((p) => visibleTo(p, account) && (!p.imported || role !== "student"))))
      .catch((e) => setError(String(e)));

  useEffect(() => {
    refresh();
    if (!account) return;
    let live = true;
    (async () => {
      setSyncing(true);
      try {
        const before = (await listProjects()).filter((p) => !p.imported && !p.owner).length;
        const r = await syncAll(account);
        if (!live) return;
        const notes = [];
        if (before) notes.push(`${before} project${before === 1 ? "" : "s"} already on this computer ${before === 1 ? "was" : "were"} added to your account.`);
        if (r.downloaded) notes.push(`${r.downloaded} project${r.downloaded === 1 ? "" : "s"} downloaded from your account.`);
        if (r.conflicts) notes.push("A project was changed on two computers; this computer's version was kept as a copy.");
        setSyncNote(notes.join(" "));
      } catch {
        if (live) setSyncNote("Couldn't reach the cloud right now. Your work is safe on this computer and will sync later.");
      } finally {
        if (live) {
          setSyncing(false);
          refresh();
        }
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id, role]);

  const [creating, setCreating] = useState(false);
  async function create(c: NewProjectChoice) {
    const p = await createProject(c.title, account?.id, { classId: c.classId, kitId: c.kitId });
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
    const inCloud = !!account && p.owner === account.id;
    if (!confirm(`Delete "${p.title}" and its whole recording${inCloud ? " from your account and every computer" : ""}? This can't be undone.`)) return;
    if (inCloud) {
      try {
        await deleteFromCloud(p.id, account!);
      } catch {
        setError("Couldn't delete it from the cloud. Check your connection and try again.");
        return;
      }
    }
    await deleteProject(p.id);
    refresh();
  }

  return (
    <section>
      <div className="row section-head">
        <h2>{heading}</h2>
        <span className="spacer" />
        {role !== "student" && (
          <>
            <button onClick={() => fileRef.current?.click()} title="Open a project file someone shared with you">Open a project file…</button>
            <input ref={fileRef} type="file" accept=".rsproj,.json,application/json,application/gzip" hidden onChange={onImport} />
          </>
        )}
        <button className="primary" onClick={() => setCreating(true)}>New project</button>
      </div>
      {creating && <NewProjectDialog account={account} role={role} onCancel={() => setCreating(false)} onCreate={create} />}
      {!account && (
        <p className="banner-inline">
          You&apos;re not signed in, so projects are saved only in this browser on this computer. <Link href="/">Create an account or sign in</Link> to keep them in your account.
        </p>
      )}
      {syncing && <p className="small muted">Syncing with your account…</p>}
      {!syncing && syncNote && <p className="small muted">{syncNote}</p>}
      {error && <p className="error">{error}</p>}

      <div className="cards">
        {projects === null && <p className="muted">Loading…</p>}
        {projects?.length === 0 && (
          <div className="card empty">
            <p style={{ margin: 0 }}>No projects yet.</p>
            <p className="small muted" style={{ margin: "4px 0 0" }}>Click <b>New project</b> to start writing.</p>
          </div>
        )}
        {projects?.map((p) => (
          <div className="card row" key={p.id}>
            <div>
              <h3>{p.imported ? <Link href={`/replay/${p.id}`}>{p.title}</Link> : <Link href={`/write/${p.id}`}>{p.title}</Link>}</h3>
              <div className="muted small">
                {p.imported ? `Opened from a file${p.author ? ` · ${p.author}` : ""} · ` : ""}
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
    </section>
  );
}
