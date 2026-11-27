"use client";
// "Turn in": shares a project with a class's instructor, read-only, exactly as it
// stands at that moment. Turning in again updates what the instructor sees.
import { useEffect, useState } from "react";
import { myClasses, submissionsFor, turnIn, type MyClass, type Submission } from "@/lib/classes";
import { currentAccount, type Account } from "@/lib/cloud";
import { getProject } from "@/lib/store";

export default function TurnInButton({ projectId, beforeTurnIn }: { projectId: string; beforeTurnIn?: () => Promise<void> }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [classes, setClasses] = useState<MyClass[]>([]);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    (async () => {
      const a = await currentAccount();
      const p = await getProject(projectId);
      if (!a || !p || (p.owner && p.owner !== a.id)) return;
      setAccount(a);
      const cs = await myClasses(a).catch(() => []);
      setClasses(cs);
      if (cs.length) setSubs(await submissionsFor(projectId).catch(() => []));
    })();
  }, [projectId]);

  if (!account || classes.length === 0) return null;

  async function go(c: MyClass) {
    setError("");
    setDone("");
    setBusy(c.class_id);
    try {
      await beforeTurnIn?.();
      const s = await turnIn(account!, c.class_id, projectId);
      setSubs((all) => [...all.filter((x) => x.class_id !== c.class_id), s]);
      setDone(`Turned in to ${c.name}. Your instructor can now see this project, as it is right now.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const any = subs.length > 0;
  return (
    <>
      <button onClick={() => setOpen(true)} className={any ? "on" : ""} title="Share this project with your instructor">
        {any ? "Turned in ✓" : "Turn in"}
      </button>
      {open && (
        <div className="modal-back" onClick={(e) => e.target === e.currentTarget && !busy && setOpen(false)}>
          <div className="modal" role="dialog" aria-label="Turn in">
            <div className="row">
              <h2 style={{ margin: 0 }}>Turn in</h2>
              <span className="spacer" />
              <button className="ghost" onClick={() => setOpen(false)} disabled={!!busy} aria-label="Close">✕</button>
            </div>
            <p className="small muted">
              Turning in lets your instructor see this paper, its writing replay and your reflections, exactly as they are now. They can't
              change anything. If you keep working, turn in again to update what they see. Projects you don't turn in stay private.
            </p>
            {classes.map((c) => {
              const s = subs.find((x) => x.class_id === c.class_id);
              return (
                <div className="choice" key={c.class_id}>
                  <div>
                    <b>{c.name}</b>
                    <div className="small muted">{s ? `Turned in ${new Date(s.turned_in_at).toLocaleString()} · ${s.word_count} words` : "Not turned in yet"}</div>
                  </div>
                  <button className="primary" onClick={() => go(c)} disabled={!!busy}>
                    {busy === c.class_id ? "Turning in…" : s ? "Turn in again" : "Turn in"}
                  </button>
                </div>
              );
            })}
            {done && <p className="small" style={{ color: "var(--note)" }}>{done}</p>}
            {error && <p className="error">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
