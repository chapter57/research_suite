"use client";
import { useState } from "react";
import { signIn, signOutOnly, signUp, type Account } from "@/lib/cloud";
import { allSynced, forgetLocal, syncAll } from "@/lib/sync";

export default function AccountPanel({
  account,
  syncing,
  syncNote,
  onChange,
}: {
  account: Account | null | undefined;
  syncing: boolean;
  syncNote: string;
  onChange: () => void;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (account === undefined) return <div className="card small muted">Checking your account…</div>;

  if (account) {
    async function out() {
      setBusy(true);
      setError("");
      try {
        await syncAll(account!).catch(() => {});
        if (!(await allSynced(account!))) {
          const ok = confirm(
            "Some of your recent work hasn't reached the cloud yet (are you offline?). If you sign out now, that work stays only on this computer and won't be in your account. Sign out anyway?",
          );
          if (!ok) return;
        } else {
          // Shared computers: remove this account's copies; they are safe in the cloud.
          await forgetLocal(account!);
        }
        await signOutOnly();
        onChange();
      } finally {
        setBusy(false);
      }
    }
    return (
      <div className="card row account">
        <div>
          <b>{account.name}</b> <span className="muted small">{account.email}</span>
          <div className="small muted">{syncing ? "Syncing with the cloud…" : syncNote || "Your projects are saved to your account and available on any computer."}</div>
        </div>
        <span className="spacer" />
        <button onClick={out} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "signup") {
        if (!name.trim()) throw new Error("Please enter your name.");
        await signUp(name, email, password);
      } else await signIn(email, password);
      setPassword("");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card account-form" onSubmit={submit}>
      <div className="row">
        <h3 style={{ margin: 0 }}>{mode === "signin" ? "Sign in" : "Create your account"}</h3>
        <span className="spacer" />
        <button type="button" className="ghost small" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); }}>
          {mode === "signin" ? "New here? Create an account" : "Have an account? Sign in"}
        </button>
      </div>
      <p className="small muted" style={{ margin: "4px 0 10px" }}>
        Sign in to save your work to the cloud and pick up where you left off on any computer.
      </p>
      <div className="fields">
        {mode === "signup" && (
          <label className="field">
            <span>Your name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="First Last" />
          </label>
        )}
        <label className="field">
          <span>School email</span>
          <input type="text" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@school.edu" />
        </label>
        <label className="field">
          <span>Password{mode === "signup" ? " (at least 6 characters)" : ""}</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="primary" type="submit" disabled={busy || !email || !password}>
          {busy ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
        {mode === "signin" && <span className="small muted">Forgot your password? Ask your instructor.</span>}
      </div>
    </form>
  );
}
