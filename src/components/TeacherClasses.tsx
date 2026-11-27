"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { classDisplayName, classesITeach, createClass, type ClassInfo } from "@/lib/classes";
import { sb, type Account } from "@/lib/cloud";
import { catalogTitle, isCopyOf, starters } from "@/lib/coach/kits";
import { createKit, frozenCopy, myKits, type KitRow } from "@/lib/kitsClient";
import KitPreviewModal from "./KitPreview";

type Row = ClassInfo & { students: number; turnedIn: number };

export default function TeacherClasses({ account }: { account: Account }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [newName, setNewName] = useState("");
  const [kits, setKits] = useState<KitRow[]>([]);
  const [kitChoice, setKitChoice] = useState("");
  const [previewing, setPreviewing] = useState(false);
  // Starters you already have a copy of aren't listed twice.
  const unusedStarters = starters.filter((s) => s.id !== "blank" && !kits.some((k) => isCopyOf(k.content, s)));
  const chosen = kitChoice.startsWith("starter:")
    ? { kit: starters.find((x) => x.id === kitChoice.slice(8))?.kit, version: undefined, heading: "Starter kit" }
    : { kit: kits.find((k) => `kit:${k.id}` === kitChoice)?.content, version: kits.find((k) => `kit:${k.id}` === kitChoice)?.version, heading: "Your course kit" };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    try {
      const [classes, shelf] = await Promise.all([classesITeach(account), myKits(account)]);
      setKits(shelf);
      setKitChoice((c) => c || (shelf[0] ? `kit:${shelf[0].id}` : "starter:english102"));
      const ids = classes.map((c) => c.id);
      const [en, sub] = ids.length
        ? await Promise.all([sb().from("enrollments").select("class_id").in("class_id", ids), sb().from("submissions").select("class_id").in("class_id", ids)])
        : [{ data: [] }, { data: [] }];
      const count = (list: { class_id: string }[] | null, id: string) => (list ?? []).filter((x) => x.class_id === id).length;
      setRows(classes.map((c) => ({ ...c, students: count(en.data as { class_id: string }[], c.id), turnedIn: count(sub.data as { class_id: string }[], c.id) })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      let row: KitRow | undefined;
      if (kitChoice.startsWith("starter:")) {
        // A starter goes onto your shelf first (once), so you can edit it for future classes.
        const starter = starters.find((s) => s.id === kitChoice.slice(8))!;
        row = kits.find((k) => isCopyOf(k.content, starter)) ?? (await createKit({ ...starter.kit, starterId: starter.id }));
      } else row = kits.find((k) => `kit:${k.id}` === kitChoice);
      if (!row) throw new Error("Choose a course kit for this class.");
      const c = await createClass(newName, frozenCopy(row));
      setRows((r) => [...(r ?? []), { ...c, students: 0, turnedIn: 0 }]);
      setNewName("");
      setNote(`Created "${classDisplayName(c.name, c.kit)}". Give students the join code ${c.code}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="row section-head"><h2>Your classes</h2></div>
      {rows === null && <p className="muted">Loading…</p>}
      {rows?.length === 0 && (
        <div className="card empty">
          <p style={{ margin: 0 }}>You don&apos;t have any classes yet.</p>
          <p className="small muted" style={{ margin: "4px 0 0" }}>Create one below. Students join it with a code, then turn in projects for you to review.</p>
        </div>
      )}
      <div className="class-grid">
        {rows?.map((c) => (
          <Link href={`/class/${c.id}`} className="card class-card" key={c.id}>
            <span className="class-name">{c.kit ? catalogTitle(c.kit) : c.name}</span>
            {c.kit && <span className="small">{c.name}</span>}
            <span className="small muted">Join code <code className="code">{c.code}</code></span>
            <span className="class-stats">
              <span><b>{c.students}</b> student{c.students === 1 ? "" : "s"}</span>
              <span><b>{c.turnedIn}</b> turned in</span>
            </span>
          </Link>
        ))}
      </div>
      <form className="card create-class" style={{ marginTop: 12 }} onSubmit={create}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Create a class</h3>
        <div className="fields">
          <label className="field">
            <span>
              Course kit (plugged in for the life of the class){" "}
              {chosen.kit && <button type="button" className="linklike small" onClick={() => setPreviewing(true)}>Preview kit</button>}
            </span>
            <select value={kitChoice} onChange={(e) => setKitChoice(e.target.value)} aria-label="Course kit">
              {kits.length > 0 && (
                <optgroup label="Your course kits">
                  {kits.map((k) => <option key={k.id} value={`kit:${k.id}`}>{catalogTitle(k.content)} (version {k.version})</option>)}
                </optgroup>
              )}
              {unusedStarters.length > 0 && (
                <optgroup label="Starter kits">
                  {unusedStarters.map((s) => <option key={s.id} value={`starter:${s.id}`}>{s.label}</option>)}
                </optgroup>
              )}
            </select>
          </label>
          <label className="field">
            <span>Section name</span>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Maymester 2027, Section 03" aria-label="New class name" />
          </label>
        </div>
        <div className="row">
          <button type="submit" className="primary" disabled={busy || !newName.trim() || rows === null || !kitChoice}>Create class</button>
          <span className="small muted">You can swap the kit until the first student joins. After that it&apos;s locked.</span>
        </div>
      </form>
      {previewing && chosen.kit && <KitPreviewModal kit={chosen.kit} version={chosen.version} heading={chosen.heading} onClose={() => setPreviewing(false)} />}
      {note && <p className="small" style={{ color: "var(--note)" }}>{note}</p>}
      {error && <p className="error">{error}</p>}
      <p className="small muted" style={{ marginTop: 18 }}>
        Want to see what students see? Use <Link href="/projects">My projects</Link> to write and replay your own work, or create a separate student
        account in a private browser window and join your class with its code.
      </p>
    </section>
  );
}
