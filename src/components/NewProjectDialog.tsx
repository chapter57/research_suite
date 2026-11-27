"use client";
import { useEffect, useState } from "react";
import { myClasses, type MyClass } from "@/lib/classes";
import type { Account, Role } from "@/lib/cloud";
import { catalogTitle } from "@/lib/coach/kits";
import { myKits, type KitRow } from "@/lib/kitsClient";

export interface NewProjectChoice {
  title: string;
  classId?: string;
  kitId?: string;
}

export default function NewProjectDialog({
  account,
  role,
  onCancel,
  onCreate,
}: {
  account: Account | null;
  role?: Role;
  onCancel: () => void;
  onCreate: (c: NewProjectChoice) => void;
}) {
  const [title, setTitle] = useState("");
  const [classes, setClasses] = useState<MyClass[] | null>(null);
  const [kits, setKits] = useState<KitRow[] | null>(null);
  const [choice, setChoice] = useState("");

  useEffect(() => {
    if (!account) return;
    if (role === "teacher") myKits(account).then(setKits).catch(() => setKits([]));
    else
      myClasses(account)
        .then((c) => {
          setClasses(c);
          if (c.length) setChoice(`class:${c[0].class_id}`);
        })
        .catch(() => setClasses([]));
  }, [account, role]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onCreate({
      title: title.trim() || "Untitled project",
      classId: choice.startsWith("class:") ? choice.slice(6) : undefined,
      kitId: choice.startsWith("kit:") ? choice.slice(4) : undefined,
    });
  }

  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="modal" role="dialog" aria-label="New project" onSubmit={submit}>
        <h2 style={{ margin: 0 }}>New project</h2>
        <label className="field">
          <span>Project name</span>
          <input type="text" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Research Essay" aria-label="Project name" />
        </label>
        {account && role !== "teacher" && classes && classes.length > 0 && (
          <label className="field">
            <span>Which class is this for?</span>
            <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Class">
              {classes.map((c) => <option key={c.class_id} value={`class:${c.class_id}`}>{c.name}</option>)}
              <option value="">Not for a class</option>
            </select>
          </label>
        )}
        {account && role === "teacher" && kits && (
          <label className="field">
            <span>Coach this project with which course kit?</span>
            <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Course kit">
              <option value="">General academic writing</option>
              {kits.map((k) => <option key={k.id} value={`kit:${k.id}`}>{catalogTitle(k.content)}</option>)}
            </select>
          </label>
        )}
        {account && (role === "teacher" ? kits === null : classes === null) && <p className="small muted" style={{ margin: 0 }}>Loading your {role === "teacher" ? "course kits" : "classes"}…</p>}
        <div className="row" style={{ marginTop: 6 }}>
          <button type="submit" className="primary" disabled={!!account && (role === "teacher" ? kits === null : classes === null)}>Create project</button>
          <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
