"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AccountPanel from "@/components/AccountPanel";
import ClassesPanel from "@/components/ClassesPanel";
import { useAccount } from "@/lib/cloud";
import { createProject, deleteProject, importProject, listProjects } from "@/lib/store";
import { deleteFromCloud, syncAll, visibleTo } from "@/lib/sync";
import type { Project } from "@/lib/types";

export default function Home() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const account = useAccount();
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState("");
  const [tick, setTick] = useState(0);

  const refresh = () =>
    listProjects()
      .then((all) => setProjects(all.filter((p) => visibleTo(p, account ?? null))))
      .catch((e) => setError(String(e)));

  useEffect(() => {
    if (account === undefined) return;
    refresh();
    if (!account) return;
    let live = true;
    (async () => {
      setSyncing(true);
      setSyncNote("");
      try {
        const before = (await listProjects()).filter((p) => !p.imported && !p.owner).length;
        const r = await syncAll(account);
        if (!live) return;
        const notes = [];
        if (before) notes.push(`${before} project${before === 1 ? "" : "s"} already on this computer ${before === 1 ? "was" : "were"} added to your account.`);
        if (r.downloaded) notes.push(`${r.downloaded} project${r.downloaded === 1 ? "" : "s"} downloaded from your account.`);
        if (r.conflicts) notes.push(`A project was changed on two computers; this computer's version was kept as a copy.`);
        setSyncNote(notes.join(" ") || "Everything is up to date.");
      } catch {
        if (live) setSyncNote("Couldn't reach the cloud right now. Your work is safe on this computer and will sync later.");
      } finally {
        if (live) setSyncing(false);
        if (live) refresh();
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id, account === undefined, tick]);

  async function onNew() {
    const title = prompt("Name your project", "Untitled project");
    if (title === null) return;
    const p = await createProject(title.trim() || "Untitled project", account?.id);
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
    <main className="home">
      <h1>Research Suite</h1>
      <p className="muted">Write your project, and the studio quietly records how it takes shape. Afterward, replay your process and talk through your thinking.</p>

      <AccountPanel account={account} syncing={syncing} syncNote={syncNote} onChange={() => setTick((t) => t + 1)} />
      {account && <ClassesPanel account={account} />}

      <div className="row" style={{ marginTop: 16 }}>
        <button className="primary" onClick={onNew}>New project</button>
        <button onClick={() => fileRef.current?.click()}>Open a shared recording…</button>
        <input ref={fileRef} type="file" accept=".rsproj,.json,application/json,application/gzip" hidden onChange={onImport} />
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
        {account
          ? "Your projects are saved in this browser and in your account. Signing out removes them from this computer; they stay in your account."
          : "Not signed in: projects are saved only in this browser on this computer. Sign in to keep them in your account."}
      </p>
    </main>
  );
}
