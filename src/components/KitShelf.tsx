"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { classesITeach } from "@/lib/classes";
import type { Account } from "@/lib/cloud";
import { catalogTitle, starters } from "@/lib/coach/kits";
import { createKit, myKits, type KitRow } from "@/lib/kitsClient";

export default function KitShelf({ account }: { account: Account }) {
  const router = useRouter();
  const [kits, setKits] = useState<KitRow[] | null>(null);
  const [uses, setUses] = useState<Record<string, number>>({});
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [k, classes] = await Promise.all([myKits(account), classesITeach(account)]);
        setKits(k);
        const u: Record<string, number> = {};
        for (const c of classes) if (c.kit?.kitId) u[c.kit.kitId] = (u[c.kit.kitId] ?? 0) + 1;
        setUses(u);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setKits([]);
      }
    })();
  }, [account]);

  async function start(id: string) {
    setBusy(true);
    try {
      const s = starters.find((x) => x.id === id)!;
      const row = await createKit(s.kit);
      router.push(`/kits/${row.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="row section-head">
        <h2>Course kits</h2>
        <span className="spacer" />
        <button className="primary" onClick={() => setChoosing((v) => !v)}>New kit</button>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        A course kit tells the AI coach about a course: its catalog title, its ethos, and the objectives that run through every assignment. When
        you create a class, you plug in a kit, and that class keeps that version for good. Editing a kit here only affects classes you create
        later.
      </p>
      {choosing && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>Start from…</h3>
          <div className="class-grid">
            {starters.map((s) => (
              <button key={s.id} className="choice-card" disabled={busy} onClick={() => start(s.id)}>
                <span className="choice-title" style={{ fontSize: 17 }}>{s.label}</span>
                <span className="choice-text">{s.blurb}</span>
              </button>
            ))}
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>You can edit everything after choosing. Building a kit from your syllabus is coming soon.</p>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {kits === null && <p className="muted">Loading…</p>}
      {kits?.length === 0 && !choosing && (
        <div className="card empty">
          <p style={{ margin: 0 }}>No course kits yet.</p>
          <p className="small muted" style={{ margin: "4px 0 0" }}>Click <b>New kit</b> and start from English 102, Literary Theory, or a blank kit.</p>
        </div>
      )}
      <div className="class-grid">
        {kits?.map((k) => (
          <Link href={`/kits/${k.id}`} className="card class-card" key={k.id}>
            <span className="class-name">{catalogTitle(k.content)}</span>
            {k.content.institution && <span className="small muted">{k.content.institution}</span>}
            <span className="class-stats">
              <span><b>{k.content.objectives.filter((o) => o.name.trim()).length}</b> {(k.content.objectiveLabel || "objective").toLowerCase()}s</span>
              <span>version {k.version}</span>
              <span><b>{uses[k.id] ?? 0}</b> class{(uses[k.id] ?? 0) === 1 ? "" : "es"}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
