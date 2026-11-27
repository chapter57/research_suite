"use client";
import { useEffect, useState } from "react";
import { joinClass, leaveClass, myClasses, type MyClass } from "@/lib/classes";
import type { Account } from "@/lib/cloud";

export default function StudentClasses({ account }: { account: Account }) {
  const [joined, setJoined] = useState<MyClass[] | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = () => myClasses(account).then(setJoined).catch(() => setJoined([]));
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
    <section>
      <div className="row section-head"><h2>My classes</h2></div>
      <div className="card classes">
        {joined === null && <p className="small muted">Loading…</p>}
        {joined?.length === 0 && <p className="small muted" style={{ margin: 0 }}>You haven&apos;t joined a class yet. Ask your instructor for the join code.</p>}
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
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) run(async () => { const r = await joinClass(code); setCode(""); setNote(`You joined ${r.class_name}. When a project is ready, open it and click "Turn in" to share it with your instructor.`); });
          }}
        >
          <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Join code" maxLength={12} style={{ width: 140, letterSpacing: ".1em" }} aria-label="Class join code" />
          <button type="submit" disabled={busy || !code.trim()}>Join class</button>
        </form>
        {note && <p className="small" style={{ color: "var(--note)", margin: 0 }}>{note}</p>}
        {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      </div>
    </section>
  );
}
