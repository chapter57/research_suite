"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { classDisplayName, classSubmissions, getClass, removeStudent, roster, type ClassInfo, type Enrollment, type Submission } from "@/lib/classes";
import { catalogTitle, plural } from "@/lib/coach/kits";
import { myKits, plugKit, type KitRow } from "@/lib/kitsClient";
import KitPreviewModal from "./KitPreview";
import MoodlePanel from "./MoodlePanel";
import { sb, useSession } from "@/lib/cloud";
import SiteHeader from "./SiteHeader";

export default function ClassPage({ classId }: { classId: string }) {
  const { account, role } = useSession();
  const router = useRouter();
  const [cls, setCls] = useState<ClassInfo | null | undefined>(undefined);
  const [people, setPeople] = useState<Enrollment[]>([]);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedKind, setCopiedKind] = useState("");
  const [shelf, setShelf] = useState<KitRow[] | null>(null);
  const [swapTo, setSwapTo] = useState("");
  const [viewing, setViewing] = useState(false);

  async function load() {
    try {
      const c = await getClass(classId);
      setCls(c);
      if (!c) return;
      const [r, s] = await Promise.all([roster(classId), classSubmissions(classId)]);
      setPeople(r);
      setSubs(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    if (account) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id, classId]);

  if (account === undefined) return <main className="home"><p className="muted">Loading…</p></main>;
  if (!account) return <main className="home"><p>Please <Link href="/">sign in</Link> first.</p></main>;
  if (cls === null) return <main className="home"><p className="error">Class not found, or you're not its instructor.</p><Link href="/">Back</Link></main>;
  if (!cls) return <main className="home"><p className="muted">Loading class…</p></main>;

  const nameOf = (id: string) => people.find((p) => p.student === id)?.student_name || "(student left the class)";
  const countFor = (id: string) => subs.filter((s) => s.student === id).length;

  const joinLink = typeof window !== "undefined" ? `${window.location.origin}/join/${cls.code}` : `/join/${cls.code}`;
  const moodleText = `Join our class in Research Suite, where you'll write and reflect on your projects: ${joinLink}\nCreate a student account (or sign in), and you'll be added to the class automatically. If you're asked for a join code, it's ${cls.code}.`;
  const [copiedWhat, setCopiedWhat] = [copiedKind, setCopiedKind];
  async function copyText(text: string, kind: string) {
    await navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedWhat(kind);
    setTimeout(() => setCopiedWhat(""), 1500);
  }

  async function copy() {
    await navigator.clipboard?.writeText(cls!.code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function remove(p: Enrollment) {
    if (!confirm(`Remove ${p.student_name || p.student_email} from ${cls!.name}? You'll no longer see work they turned in.`)) return;
    try {
      await removeStudent(classId, p.student);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteClass() {
    if (!confirm(`Delete the class "${cls!.name}"? Students will be removed from it and you'll lose access to work turned in to it. Students keep their own projects.`)) return;
    const res = await sb().from("classes").delete().eq("id", classId);
    if (res.error) return setError(res.error.message);
    router.push("/");
  }

  return (
    <>
      <SiteHeader account={account} role={role} active="teaching" />
      <main className="home wide">
        <div className="row section-head">
          <Link href="/" className="small">← All classes</Link>
        </div>
        <div className="row section-head">
          <h2>{classDisplayName(cls.name, cls.kit)}</h2>
          <span className="spacer" />
          <button onClick={load}>Refresh</button>
        </div>
        <section className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>Course kit {people.length > 0 ? "🔒" : ""}</h3>
          {cls.kit ? (
            <p style={{ margin: 0 }}>
              <b>{catalogTitle(cls.kit)}</b> <span className="muted small">version {cls.kit.version} · {cls.kit.objectives.length} {plural((cls.kit.objectiveLabel || "objective").toLowerCase())}</span>{" "}
              <button className="small" onClick={() => setViewing(true)}>View kit</button>
            </p>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>No course kit. The coach uses general academic writing guidance.</p>
          )}
          {people.length > 0 ? (
            <p className="small muted" style={{ marginBottom: 0 }}>Locked: students have joined, so this class keeps this kit for good. Edits to the kit on your shelf apply to classes you create later.</p>
          ) : shelf === null ? (
            <p style={{ marginBottom: 0 }}><button className="small" onClick={() => myKits(account!).then(setShelf)}>Swap kit</button> <span className="small muted">You can swap until the first student joins.</span></p>
          ) : (
            <div className="row" style={{ marginTop: 8 }}>
              <select value={swapTo} onChange={(e) => setSwapTo(e.target.value)} aria-label="Kit to plug in">
                <option value="">Choose a kit from your shelf…</option>
                {shelf.map((k) => <option key={k.id} value={k.id}>{catalogTitle(k.content)} (version {k.version})</option>)}
              </select>
              <button
                className="primary"
                disabled={!swapTo}
                onClick={async () => {
                  try {
                    await plugKit(classId, shelf.find((k) => k.id === swapTo)!);
                    setShelf(null);
                    setSwapTo("");
                    await load();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                Plug in
              </button>
              <button className="ghost small" onClick={() => setShelf(null)}>Cancel</button>
            </div>
          )}
        </section>

        <section className="card">
          <h3 style={{ marginTop: 0 }}>Join code</h3>
          <div className="row">
            <code className="code big-code">{cls.code}</code>
            <button onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <p className="small muted">
            Students can type this code under &quot;My classes&quot;, or simply click the class&apos;s join link:
          </p>
          <div className="row">
            <code className="join-link">{joinLink}</code>
            <button onClick={() => copyText(joinLink, "link")}>{copiedWhat === "link" ? "Copied" : "Copy link"}</button>
            <button onClick={() => copyText(moodleText, "moodle")}>{copiedWhat === "moodle" ? "Copied" : "Copy text for Moodle"}</button>
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>
            In Moodle, add the link with the <b>URL</b> activity, or paste the text into an announcement.
          </p>
        </section>

        <MoodlePanel classId={classId} />

        <section className="card" style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Turned-in work ({subs.length})</h3>
          {subs.length === 0 ? (
            <p className="small muted">Nothing turned in yet. Students use the <b>Turn in</b> button on a project.</p>
          ) : (
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr><th>Student</th><th>Project</th><th>Words</th><th>Turned in</th><th></th></tr>
                </thead>
                <tbody>
                  {subs.map((s) => (
                    <tr key={s.project_id}>
                      <td>{nameOf(s.student)}</td>
                      <td>{s.title}</td>
                      <td>{s.word_count.toLocaleString()}</td>
                      <td>{new Date(s.turned_in_at).toLocaleString()}</td>
                      <td><Link href={`/review/${classId}/${s.project_id}`}><button className="primary">Review</button></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card" style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Students ({people.length})</h3>
          {people.length === 0 ? (
            <p className="small muted">No one has joined yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr><th>Name</th><th>Email</th><th>Joined</th><th>Turned in</th><th></th></tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.student}>
                      <td>{p.student_name}</td>
                      <td>{p.student_email}</td>
                      <td>{new Date(p.joined_at).toLocaleDateString()}</td>
                      <td>{countFor(p.student)}</td>
                      <td><button className="ghost small" onClick={() => remove(p)}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {viewing && cls.kit && (
          <KitPreviewModal kit={cls.kit} version={cls.kit.version} heading={people.length ? "This class's course kit (locked)" : "This class's course kit"} onClose={() => setViewing(false)} />
        )}
        {error && <p className="error">{error}</p>}
        <p style={{ marginTop: 24 }}>
          <button className="ghost small" onClick={deleteClass}>Delete this class</button>
        </p>
      </main>
    </>
  );
}
