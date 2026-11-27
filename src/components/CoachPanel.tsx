"use client";
import { useEffect, useRef, useState } from "react";
import { course } from "@/config/course";
import { modes, type ModeId } from "@/lib/coach/modes";
import { catalogTitle, generalWriting, type KitContent } from "@/lib/coach/kits";
import { modeLabel } from "@/lib/coach/prompt";
import { accessToken, kitForProject } from "@/lib/kitsClient";
import type { AiEvent } from "@/lib/types";

type Scope = "selection" | "paragraph" | "draft" | "none";
interface Msg {
  role: "user" | "assistant";
  content: string;
}

function clientId(): string {
  try {
    let id = localStorage.getItem("rs-client-id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("rs-client-id", id);
    }
    return id;
  } catch {
    return "anon";
  }
}


export default function CoachPanel({
  getExcerpt,
  onExchange,
  project,
  testKit,
}: {
  /** Writing screen: pulls text from the draft. Absent in "Test the coach". */
  getExcerpt?: (scope: "selection" | "paragraph" | "draft") => string;
  onExchange?: (e: Omit<AiEvent, "type" | "t">) => void;
  /** Which class or kit the project is for. */
  project?: { classId?: string; kitId?: string };
  /** Kit editor: test this kit as it stands (teachers only). */
  testKit?: KitContent;
}) {
  const available = modes.filter((m) => course.allowedModes.includes(m.id));
  const [mode, setMode] = useState<ModeId>(available[0]?.id ?? "socratic");
  const [focus, setFocus] = useState("");
  const [scope, setScope] = useState<Scope>(getExcerpt ? "paragraph" : "none");
  const [sample, setSample] = useState("");
  const [loadedKit, setLoadedKit] = useState<KitContent>(generalWriting);
  const kit = testKit ?? loadedKit;
  useEffect(() => {
    if (!testKit) kitForProject(project ?? {}).then(setLoadedKit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.classId, project?.kitId, !!testKit]);
  const [question, setQuestion] = useState("");
  const [thread, setThread] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [thread, busy]);

  const current = available.find((m) => m.id === mode);

  async function ask() {
    setError("");
    const excerpt = getExcerpt ? (scope === "none" ? "" : getExcerpt(scope)) : sample.trim();
    if (scope === "selection" && !excerpt) {
      setError("Select some text in your draft first, or choose a different option.");
      return;
    }
    if (!question.trim() && !excerpt) {
      setError("Type a question, or include part of your draft.");
      return;
    }
    const q = question.trim();
    const shown = q || "(Coach me on this part of my draft.)";
    setThread((t) => [...t, { role: "user", content: shown }]);
    setQuestion("");
    setBusy(true);
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: await (async () => {
          const h: Record<string, string> = { "content-type": "application/json", "x-client-id": clientId() };
          const t = await accessToken();
          if (t) h.authorization = `Bearer ${t}`;
          return h;
        })(),
        body: JSON.stringify({
          mode,
          focus: focus || undefined,
          question: q,
          excerpt,
          history: thread,
          ...(testKit ? { kit: testKit } : { classId: project?.classId, kitId: project?.kitId }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.answer) {
        setError(data.error || "The coach couldn't respond.");
        setThread((t) => t.slice(0, -1));
        setQuestion(q);
        return;
      }
      setThread((t) => [...t, { role: "assistant", content: data.answer }]);
      onExchange?.({ mode, badge: focus || undefined, question: excerpt ? `${shown}\n\n[Draft excerpt, ${excerpt.length} characters]` : shown, answer: data.answer });
    } catch {
      setError("Couldn't reach the coach. Check your connection.");
      setThread((t) => t.slice(0, -1));
      setQuestion(q);
    } finally {
      setBusy(false);
    }
  }

  const block = course.blockCopyFromCoach;

  return (
    <aside className="coach" aria-label="AI writing coach">
      <header>
        <h2>Writing coach</h2>
        <p className="small muted" style={{ margin: "-4px 0 8px" }}>{testKit ? "Testing: " : "Coaching for "}{catalogTitle(kit)}</p>
        <div className="modes" role="tablist">
          {available.map((m) => (
            <button key={m.id} className={m.id === mode ? "on" : ""} onClick={() => setMode(m.id)} title={m.blurb}>
              {modeLabel(m, kit.objectiveLabel)}
            </button>
          ))}
        </div>
        {current && <p className="small muted" style={{ margin: "8px 0 0" }}>{current.blurb}</p>}
        <div className="row small" style={{ marginTop: 8 }}>
          <label htmlFor="skill">{kit.objectiveLabel || "Objective"}</label>
          <select id="skill" value={focus} onChange={(e) => setFocus(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
            <option value="">Any / not sure</option>
            {kit.objectives.filter((o) => o.name.trim()).map((o) => (
              <option key={o.name} value={o.name}>{o.name}</option>
            ))}
          </select>
        </div>
      </header>

      <div className="thread" ref={threadRef} onCopy={block ? (e) => e.preventDefault() : undefined}>
        {thread.length === 0 && (
          <p className="small muted">
            The coach helps you think, read, research and revise. It won&apos;t write your paper for you. Your conversations are saved in your
            process recording so you can reflect on them later.
          </p>
        )}
        {thread.map((m, i) => (
          <div key={i} className={`bubble ${m.role} ${m.role === "assistant" && block ? "nocopy" : ""}`}>{m.content}</div>
        ))}
        {busy && <div className="bubble assistant muted">Thinking…</div>}
      </div>

      <footer>
        {getExcerpt ? (
          <div className="row small">
            <label htmlFor="scope">Include</label>
            <select id="scope" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
              <option value="paragraph">the paragraph I&apos;m in</option>
              <option value="selection">my selected text</option>
              <option value="draft">my whole draft</option>
              <option value="none">nothing from my draft</option>
            </select>
          </div>
        ) : (
          <textarea rows={3} placeholder="Optional: paste a sample of student writing for the coach to respond to" value={sample} onChange={(e) => setSample(e.target.value)} />
        )}
        <textarea
          rows={3}
          placeholder="Ask the coach… (e.g. “Is my claim arguable?”)"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
          }}
        />
        {error && <div className="error">{error}</div>}
        <div className="row">
          <span className="small muted">Ctrl/⌘ + Enter to send</span>
          <span className="spacer" />
          {thread.length > 0 && <button className="ghost small" onClick={() => setThread([])}>New topic</button>}
          <button className="primary" onClick={ask} disabled={busy}>Ask</button>
        </div>
      </footer>
    </aside>
  );
}
