"use client";
// A teacher's first visit from Moodle: sign in once to connect the two accounts.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AuthForm, { type AuthMode } from "@/components/AuthForm";
import { useSession } from "@/lib/cloud";
import { accessToken } from "@/lib/kitsClient";

export default function LtiLink() {
  const router = useRouter();
  const { account, role } = useSession();
  const [t, setT] = useState<string | null>(null);
  const [mode, setMode] = useState<AuthMode | null>("signin");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1));
    setT(h.get("t"));
  }, []);

  async function connect() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/lti/link", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${await accessToken()}` },
        body: JSON.stringify({ t }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't connect.");
      history.replaceState(null, "", window.location.pathname);
      router.replace(data.next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (t === null) return <main className="home"><p className="muted">Loading…</p></main>;
  if (!t) return <main className="home"><p className="error">This link is incomplete. Please click the activity in Moodle again.</p></main>;
  return (
    <main className="landing" style={{ maxWidth: 600 }}>
      <section className="card auth-form">
        <h2 style={{ margin: 0 }}>Connect your Moodle account</h2>
        <p className="small muted" style={{ margin: 0 }}>
          This is the first time you&apos;ve opened Research Suite from Moodle. Sign in once with your Research Suite teacher account, the one
          that owns this class. After that, the Moodle link takes you straight to your class.
        </p>
        {account === undefined || (account && !role) ? (
          <p className="muted">Loading…</p>
        ) : account ? (
          <>
            <p style={{ margin: 0 }}>Signed in as <b>{account.name}</b> ({account.email}).</p>
            <div className="row">
              <button className="primary" onClick={connect} disabled={busy}>{busy ? "Connecting…" : "Connect and go to my class"}</button>
            </div>
          </>
        ) : null}
        {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      </section>
      {account === null && mode && (
        <div style={{ marginTop: 12 }}>
          <AuthForm mode={mode} setMode={(m) => setMode(m ?? "signin")} onDone={() => {}} />
        </div>
      )}
    </main>
  );
}
