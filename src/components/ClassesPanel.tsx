"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { classesITeach, createClass, isInstructor, joinClass, leaveClass, myClasses, type ClassInfo, type MyClass } from "@/lib/classes";
import type { Account } from "@/lib/cloud";

export default function ClassesPanel({ account }: { account: Account }) {
  const [teacher, setTeacher] = useState(false);
  const [teaching, setTeaching] = useState<ClassInfo[]>([]);
  const [joined, setJoined] = useState<MyClass[] | null>(null);
  const [code, setCode] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    try {
      const [t, mine] = await Promise.all([isInstructor(account), myClasses(account)]);
      setTeacher(t);
      setJoined(mine);
      if (t) setTeaching(await classesITeach(account));
    } catch {
      setJoined([]);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card classes">
      {teacher && (
        <div className="teach">
          <h3>Classes you teach</h3>
          {teaching.length === 0 && <p className="small muted">No classes yet. Create one, then give students its join code.</p>}
          {teaching.map((c) => (
            <div className="row class-row" key={c.id}>
              <Link href={`/class/${c.id}`}><b>{c.name}</b></Link>
              <span className="small muted">Join code <code className="code">{c.code}</code></span>
              <span className="spacer" />
              <Link href={`/class/${c.id}`}><button>Open</button></Link>
            </div>
          ))}
          <form
            className="row"
            style={{ marginTop: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) run(async () => { const c = await createClass(newName); setNewName(""); setNote(`Created "${c.name}". Its join code is ${c.code}.`); });
            }}
          >
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New class name, e.g. ENGL 102 Spring" style={{ flex: 1, minWidth: 180 }} />
            <button type="submit" disabled={busy || !newName.trim()}>Create class</button>
          </form>
        </div>
      )}

      <div>
        <h3>{teacher ? "Classes you've joined" : "Your classes"}</h3>
        {joined === null && <p className="small muted">Loading…</p>}
        {joined?.length === 0 && <p className="small muted">You haven't joined a class yet. Ask your instructor for the join code.</p>}
        {joined?.map((c) => (
          <div className="row class-row" key={c.class_id}>
            <b>{c.name}</b>
            <span className="small muted">joined {new Date(c.joined_at).toLocaleDateString()}</span>
            <span className="spacer" />
            <button
              className="ghost small"
              disabled={busy}
              onClick={() => confirm(`Leave ${c.name}? Work you turned in will no longer be visible to the instructor.`) && run(() => leaveClass(account, c.class_id))}
            >
              Leave
            </button>
          </div>
        ))}
        <form
          className="row"
          style={{ marginTop: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) run(async () => { const r = await joinClass(code); setCode(""); setNote(`You joined ${r.class_name}. Use "Turn in" on a project to share it with your instructor.`); });
          }}
        >
          <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Join code" maxLength={12} style={{ width: 140, letterSpacing: ".1em" }} aria-label="Class join code" />
          <button type="submit" disabled={busy || !code.trim()}>Join class</button>
        </form>
      </div>
      {note && <p className="small" style={{ color: "var(--note)", margin: 0 }}>{note}</p>}
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
    </section>
  );
}
