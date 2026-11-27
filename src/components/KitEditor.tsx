"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { catalogTitle, kitProblems, type KitContent, type Objective } from "@/lib/coach/kits";
import { deleteKit, getKit, saveKit, type KitRow } from "@/lib/kitsClient";
import CoachPanel from "./CoachPanel";

export default function KitEditor({ kitId }: { kitId: string }) {
  const router = useRouter();
  const [row, setRow] = useState<KitRow | null | undefined>(undefined);
  const [k, setK] = useState<KitContent | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [testing, setTesting] = useState(true);

  useEffect(() => {
    getKit(kitId)
      .then((r) => {
        setRow(r);
        if (r) setK(r.content);
      })
      .catch(() => setRow(null));
  }, [kitId]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (row === undefined) return <p className="muted">Loading kit…</p>;
  if (row === null || !k) return <p className="error">Kit not found. <Link href="/kits">Back to course kits</Link></p>;

  const set = (patch: Partial<KitContent>) => {
    setK({ ...k, ...patch });
    setDirty(true);
    setNote("");
  };
  const setObj = (i: number, patch: Partial<Objective>) => set({ objectives: k.objectives.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const move = (i: number, d: number) => {
    const list = [...k.objectives];
    const [x] = list.splice(i, 1);
    list.splice(i + d, 0, x);
    set({ objectives: list });
  };
  const label = k.objectiveLabel.trim() || "Objective";

  async function save() {
    const p = kitProblems(k!);
    setProblems(p);
    if (p.length) return;
    setBusy(true);
    try {
      const saved = await saveKit(row!, { ...k!, objectives: k!.objectives.filter((o) => o.name.trim()) });
      setRow(saved);
      setK(saved.content);
      setDirty(false);
      setNote(`Saved as version ${saved.version}. Classes you create from now on will use this version.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete the kit "${catalogTitle(k!)}"? Classes already using it keep their own copy and aren't affected.`)) return;
    await deleteKit(row!.id);
    router.push("/kits");
  }

  const field = (key: keyof KitContent, title: string, placeholder = "", width?: number) => (
    <label className="field" style={width ? { maxWidth: width } : undefined}>
      <span>{title}</span>
      <input type="text" value={(k[key] as string) ?? ""} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value } as Partial<KitContent>)} />
    </label>
  );

  return (
    <div className={`kit-layout ${testing ? "with-test" : ""}`}>
      <div className="kit-form">
        <div className="row section-head">
          <Link href="/kits" className="small">← Course kits</Link>
          <span className="spacer" />
          <button onClick={() => setTesting((v) => !v)} className={testing ? "on" : ""}>Test the coach</button>
        </div>
        <h2 className="kit-title">{catalogTitle(k)}</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          Version {row.version}{dirty ? " · unsaved changes" : ""}. Saving creates a new version for future classes; classes already running keep theirs.
        </p>

        <section className="card kit-section">
          <h3>Catalog listing</h3>
          <div className="fields three">
            {field("subject", "Subject", "English", 220)}
            {field("number", "Number", "102", 120)}
            {field("title", "Course title", "Composition and Critical Reading")}
          </div>
          <div className="fields">
            {field("institution", "Institution (optional)", "Coastal Carolina University")}
            {field("level", "Level", "first-year undergraduate")}
          </div>
          <label className="field">
            <span>Course description and ethos: what the course is about and values</span>
            <textarea rows={4} value={k.description} onChange={(e) => set({ description: e.target.value })} />
          </label>
          <div className="fields">
            {field("citationStyle", "Citation style", "MLA 9th edition")}
          </div>
        </section>

        <section className="card kit-section">
          <div className="row">
            <h3 style={{ margin: 0 }}>{label}s</h3>
            <span className="spacer" />
            <label className="field" style={{ maxWidth: 220 }}>
              <span>What are they called? (singular)</span>
              <input type="text" value={k.objectiveLabel} placeholder="Objective, Badge, Lens, Outcome…" onChange={(e) => set({ objectiveLabel: e.target.value })} />
            </label>
          </div>
          <p className="small muted">These run across every assignment. The coach explains them, asks the questions you list, and students can choose one to focus on.</p>
          {k.objectives.map((o, i) => (
            <div className="objective" key={i}>
              <div className="row">
                <input type="text" className="objective-name" value={o.name} placeholder={`${label} name`} onChange={(e) => setObj(i, { name: e.target.value })} />
                <button className="ghost small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                <button className="ghost small" disabled={i === k.objectives.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                <button className="ghost small" onClick={() => set({ objectives: k.objectives.filter((_, j) => j !== i) })} aria-label={`Remove ${label.toLowerCase()}`}>✕</button>
              </div>
              <textarea rows={2} value={o.description} placeholder="What this means in your course" onChange={(e) => setObj(i, { description: e.target.value })} />
              <textarea
                rows={3}
                value={o.questions.join("\n")}
                placeholder="Questions the coach can raise (one per line)"
                onChange={(e) => setObj(i, { questions: e.target.value.split("\n") })}
                onBlur={() => setObj(i, { questions: o.questions.map((q) => q.trim()).filter(Boolean) })}
              />
            </div>
          ))}
          <button onClick={() => set({ objectives: [...k.objectives, { name: "", description: "", questions: [] }] })}>+ Add {label.toLowerCase()}</button>
        </section>

        <section className="card kit-section">
          <h3>Guidance for the coach (optional)</h3>
          <p className="small muted">Your priorities, in your own words. The coach follows them, but they can never make it write students&apos; papers.</p>
          <textarea rows={4} value={k.guidance ?? ""} placeholder="For example: Don't comment on grammar until students ask. Push for counterarguments." onChange={(e) => set({ guidance: e.target.value })} />
        </section>

        {problems.length > 0 && (
          <ul className="error">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        )}
        <div className="row kit-actions">
          <button className="primary" onClick={save} disabled={busy || !dirty}>{busy ? "Saving…" : dirty ? "Save new version" : "Saved"}</button>
          {note && <span className="small" style={{ color: "var(--note)" }}>{note}</span>}
          <span className="spacer" />
          <button className="ghost small" onClick={remove}>Delete kit</button>
        </div>
      </div>
      {testing && (
        <div className="kit-test">
          <p className="small muted kit-test-note">Ask the coach as a student would. It uses this kit as it is now, including unsaved changes.</p>
          <CoachPanel testKit={k} />
        </div>
      )}
    </div>
  );
}
