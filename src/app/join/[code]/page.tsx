"use client";
// A class invitation link: /join/ABC123. Sign in (or sign up) and you're added to the class.
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Landing from "@/components/Landing";
import SiteHeader from "@/components/SiteHeader";
import { joinClass } from "@/lib/classes";
import { useSession } from "@/lib/cloud";

export default function JoinPage() {
  const { code: raw } = useParams<{ code: string }>();
  const code = decodeURIComponent(raw).toUpperCase();
  const { account, role } = useSession();
  const router = useRouter();
  const [result, setResult] = useState<{ name?: string; error?: string } | null>(null);
  const tried = useRef(false);

  useEffect(() => {
    if (!account || role !== "student" || tried.current) return;
    tried.current = true;
    joinClass(code)
      .then((r) => {
        setResult({ name: r.class_name });
        setTimeout(() => router.push("/"), 2500);
      })
      .catch((e) => setResult({ error: e instanceof Error ? e.message : String(e) }));
  }, [account, role, code, router]);

  if (account === undefined || (account && !role)) return <main className="home"><p className="muted">Loading…</p></main>;
  if (!account) return <Landing joinCode={code} onSignedIn={() => router.refresh()} />;

  return (
    <>
      <SiteHeader account={account} role={role} active="home" />
      <main className="home">
        {role === "teacher" ? (
          <div className="card">
            <p style={{ marginTop: 0 }}>This is a student invitation link for class code <b>{code}</b>.</p>
            <p className="small muted">You&apos;re signed in with a teacher account, so you can&apos;t join as a student. To see the student side, open this link in a private browser window and create a student account.</p>
            <Link href="/"><button>Go to Teaching</button></Link>
          </div>
        ) : !result ? (
          <p className="muted">Joining class {code}…</p>
        ) : result.error ? (
          <div className="card">
            <p className="error" style={{ marginTop: 0 }}>{result.error}</p>
            <Link href="/"><button>Go to my projects</button></Link>
          </div>
        ) : (
          <div className="card">
            <p style={{ marginTop: 0 }}>You&apos;re in <b>{result.name}</b>.</p>
            <p className="small muted">When you start a new project, choose this class so the writing coach knows your course. Taking you to your projects…</p>
            <Link href="/"><button className="primary">Go to my projects</button></Link>
          </div>
        )}
      </main>
    </>
  );
}
