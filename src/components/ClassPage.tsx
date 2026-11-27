"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { classSubmissions, getClass, removeStudent, roster, type ClassInfo, type Enrollment, type Submission } from "@/lib/classes";
import { sb, useAccount } from "@/lib/cloud";

export default function ClassPage({ classId }: { classId: string }) {
  const account = useAccount();
  const router = useRouter();
  const [cls, setCls] = useState<ClassInfo | null | undefined>(undefined);
  const [people, setPeople] = useState<Enrollment[]>([]);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

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
      <div className="topbar">
        <Link href="/" className="brand">Research Suite</Link>
        <strong>{cls.name}</strong>
        <span className="spacer" />
        <button onClick={load}>Refresh</button>
      </div>
      <main className="home" style={{ maxWidth: 980 }}>
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Join code</h3>
          <div className="row">
            <code className="code big-code">{cls.code}</code>
            <button onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <p className="small muted">
            Give students this code (for example, in a Moodle announcement). They sign in at researchsuites.vercel.app, type the code under
            &quot;Your classes&quot;, and click <b>Join class</b>.
          </p>
        </section>

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

        {error && <p className="error">{error}</p>}
        <p style={{ marginTop: 24 }}>
          <button className="ghost small" onClick={deleteClass}>Delete this class</button>
        </p>
      </main>
    </>
  );
}
