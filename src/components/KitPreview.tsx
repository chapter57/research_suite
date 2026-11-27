"use client";
// Read-only view of everything in a course kit.
import { useState } from "react";
import { catalogTitle, plural, type KitContent } from "@/lib/coach/kits";

export function KitDetails({ kit, version }: { kit: KitContent; version?: number }) {
  const label = kit.objectiveLabel || "Objective";
  const objectives = kit.objectives.filter((o) => o.name.trim());
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="kit-details">
      <div>
        <div className="kit-details-title">{catalogTitle(kit)}</div>
        <div className="small muted">
          {[kit.institution, kit.level, kit.citationStyle && `Citation: ${kit.citationStyle}`, version && `Version ${version}`].filter(Boolean).join(" · ")}
        </div>
      </div>
      {kit.description && (
        <div>
          <h4>Course description and ethos</h4>
          <p>{kit.description}</p>
        </div>
      )}
      <div>
        <h4>{plural(label)} ({objectives.length})</h4>
        <p className="small muted" style={{ marginTop: 0 }}>Students see only these names in the coach&apos;s menu. Click one to see what the coach knows about it.</p>
        <ul className="objective-list" hidden={open === -1}>
          {objectives.map((o, i) => (
            <li key={i}>
              <button className="objective-toggle" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                <span>{open === i ? "▾" : "▸"}</span> <b>{o.name}</b>
              </button>
              {open === i && (
                <div className="objective-body">
                  {o.description && <p style={{ margin: "4px 0" }}>{o.description}</p>}
                  {o.questions.length > 0 && (
                    <>
                      <div className="small muted">Questions the coach can raise:</div>
                      <ul>{o.questions.map((q, j) => <li key={j}>{q}</li>)}</ul>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {objectives.length > 1 && (
          <button className="ghost small" onClick={() => setOpen(open === -1 ? null : -1)}>
            {open === -1 ? "Hide all details" : "Show all details"}
          </button>
        )}
        {open === -1 && (
          <div className="objective-all">
            {objectives.map((o, i) => (
              <div key={i} className="objective-body">
                <b>{o.name}</b>
                {o.description && <p style={{ margin: "4px 0" }}>{o.description}</p>}
                {o.questions.length > 0 && <ul>{o.questions.map((q, j) => <li key={j}>{q}</li>)}</ul>}
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <h4>Guidance for the coach</h4>
        <p>{kit.guidance?.trim() || <span className="muted">None.</span>}</p>
      </div>
    </div>
  );
}

export default function KitPreviewModal({
  kit,
  version,
  heading = "Course kit",
  onClose,
  actions,
}: {
  kit: KitContent;
  version?: number;
  heading?: string;
  onClose: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal kit-modal" role="dialog" aria-label={heading}>
        <div className="row">
          <span className="small muted" style={{ textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600 }}>{heading}</span>
          <span className="spacer" />
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <KitDetails kit={kit} version={version} />
        <div className="row" style={{ marginTop: 8 }}>
          {actions}
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
