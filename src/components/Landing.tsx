"use client";
import Link from "next/link";
import { useState } from "react";
import AuthForm, { type AuthMode } from "./AuthForm";

export default function Landing({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<AuthMode | null>(null);
  return (
    <main className="landing">
      <section className="hero">
        <h1>Research Suite</h1>
        <p className="lead">
          A writing studio where your thinking shows. Write your paper, replay how it took shape, and reflect on the choices you made along
          the way.
        </p>
      </section>

      {mode ? (
        <div className="auth-wrap">
          <AuthForm mode={mode} setMode={setMode} onDone={onSignedIn} />
        </div>
      ) : (
        <>
          <section className="choose">
            <button className="choice-card" onClick={() => setMode("student")}>
              <span className="choice-kicker">I&apos;m a student</span>
              <span className="choice-title">Create a student account</span>
              <span className="choice-text">
                Write your research paper, get a coach that asks questions instead of writing for you, and share your process with your
                instructor.
              </span>
            </button>
            <button className="choice-card" onClick={() => setMode("teacher")}>
              <span className="choice-kicker">I&apos;m a teacher</span>
              <span className="choice-title">Create a teacher account</span>
              <span className="choice-text">
                Create classes, see how your students&apos; papers took shape, and read their reflections. You can write your own projects
                too.
              </span>
            </button>
          </section>
          <p className="center">
            Already have an account? <button className="linklike" onClick={() => setMode("signin")}>Sign in</button>
          </p>
        </>
      )}

      <section className="explain">
        <div className="card">
          <h3>Your words, your process</h3>
          <p className="small muted">Every word, paste and revision is saved as a timeline, so you can watch your paper grow from first word to final draft.</p>
        </div>
        <div className="card">
          <h3>A coach, not a ghostwriter</h3>
          <p className="small muted">An optional AI coach asks questions, reacts as a reader and explains course skills. It never writes your paper.</p>
        </div>
        <div className="card">
          <h3>Reflect out loud</h3>
          <p className="small muted">Replay your writing and pin voice or text notes to the moments where your thinking changed.</p>
        </div>
      </section>
      <p className="small muted center" style={{ marginTop: 28 }}>
        Just exploring? <Link href="/projects">Try it without an account</Link> (your work stays on this computer).
      </p>
    </main>
  );
}
