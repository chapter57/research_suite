"use client";
import { useState } from "react";
import { signIn, signUp, type Role } from "@/lib/cloud";

export type AuthMode = "signin" | Role;

export default function AuthForm({ mode, setMode, onDone }: { mode: AuthMode; setMode: (m: AuthMode | null) => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signingUp = mode !== "signin";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (signingUp) {
        if (!name.trim()) throw new Error("Please enter your name.");
        await signUp(name, email, password, mode);
      } else await signIn(email, password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const heading = mode === "signin" ? "Sign in" : mode === "teacher" ? "Create a teacher account" : "Create a student account";
  return (
    <form className="card auth-form" onSubmit={submit}>
      <div className="row">
        <h2 style={{ margin: 0 }}>{heading}</h2>
        <span className="spacer" />
        <button type="button" className="ghost small" onClick={() => setMode(null)}>Back</button>
      </div>
      {mode === "teacher" && (
        <p className="small muted" style={{ margin: 0 }}>
          Teachers create classes and review work students turn in. You can also write your own projects to get to know the tools.
        </p>
      )}
      {mode === "student" && (
        <p className="small muted" style={{ margin: 0 }}>Your projects are saved to your account so you can work on any computer.</p>
      )}
      <div className="fields">
        {signingUp && (
          <label className="field">
            <span>Your name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="First Last" />
          </label>
        )}
        <label className="field">
          <span>{mode === "student" ? "School email" : "Email"}</span>
          <input type="text" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@school.edu" />
        </label>
        <label className="field">
          <span>Password{signingUp ? " (at least 6 characters)" : ""}</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={signingUp ? "new-password" : "current-password"} />
        </label>
      </div>
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      <div className="row">
        <button className="primary" type="submit" disabled={busy || !email || !password}>
          {busy ? "One moment…" : signingUp ? "Create account" : "Sign in"}
        </button>
        {mode === "signin" ? (
          <span className="small muted">Forgot your password? Ask your instructor.</span>
        ) : (
          <button type="button" className="ghost small" onClick={() => setMode("signin")}>I already have an account</button>
        )}
      </div>
    </form>
  );
}
