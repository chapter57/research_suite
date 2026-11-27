"use client";
// Class page: connect this class to a Moodle course (LTI 1.3).
import { useEffect, useState } from "react";
import { sb } from "@/lib/cloud";
import { moodleEndpointsClient } from "@/lib/lti/endpoints";

interface Reg {
  id: string;
  issuer: string;
  client_id: string;
  deployment_id: string;
  created_at: string;
}

export default function MoodlePanel({ classId }: { classId: string }) {
  const [regs, setRegs] = useState<Reg[] | null>(null);
  const [open, setOpen] = useState(false);
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [deploymentId, setDeploymentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const load = () =>
    sb()
      .from("lti_registrations")
      .select("id, issuer, client_id, deployment_id, created_at")
      .eq("class_id", classId)
      .then(({ data, error: e }) => setRegs(e ? [] : (data as Reg[])));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  async function copy(v: string, k: string) {
    await navigator.clipboard?.writeText(v).catch(() => {});
    setCopied(k);
    setTimeout(() => setCopied(""), 1500);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const iss = issuer.trim().replace(/\/+$/, "");
    if (!/^https:\/\/[^\s/]+$/.test(iss)) return setError("Enter just your Moodle's web address, starting with https:// (for example https://moodle.yourschool.edu), with nothing after it.");
    if (!clientId.trim()) return setError("Please paste the Client ID from Moodle.");
    setBusy(true);
    const { error: err } = await sb()
      .from("lti_registrations")
      .insert({ class_id: classId, issuer: iss, client_id: clientId.trim(), deployment_id: deploymentId.trim(), ...moodleEndpointsClient(iss) });
    setBusy(false);
    if (err) return setError(err.code === "23505" ? "That Moodle tool is already connected (here or to another class)." : err.message);
    setIssuer("");
    setClientId("");
    setDeploymentId("");
    setOpen(false);
    load();
  }

  async function disconnect(r: Reg) {
    if (!confirm("Disconnect this Moodle course? Students will no longer be able to open Research Suite from Moodle (their work isn't affected).")) return;
    await sb().from("lti_registrations").delete().eq("id", r.id);
    load();
  }

  const values: [string, string, string][] = [
    ["Tool name", "Research Suite", "name"],
    ["Tool URL", `${origin}/api/lti/launch`, "tool"],
    ["LTI version", "LTI 1.3", ""],
    ["Public key type", "Keyset URL", ""],
    ["Public keyset", `${origin}/api/lti/jwks`, "jwks"],
    ["Initiate login URL", `${origin}/api/lti/login`, "login"],
    ["Redirection URI(s)", `${origin}/api/lti/launch`, "redirect"],
    ["Default launch container", "New window", ""],
  ];

  return (
    <section className="card" style={{ marginTop: 12 }}>
      <div className="row">
        <h3 style={{ margin: 0 }}>Moodle</h3>
        <span className="spacer" />
        {!open && <button onClick={() => setOpen(true)}>{regs?.length ? "Connect another Moodle course" : "Connect to Moodle"}</button>}
      </div>
      {regs?.length ? (
        <div style={{ marginTop: 8 }}>
          {regs.map((r) => (
            <div className="row class-row" key={r.id}>
              <span>✓ Connected to <b>{r.issuer.replace(/^https:\/\//, "")}</b> <span className="small muted">(client ID {r.client_id}{r.deployment_id ? `, deployment ${r.deployment_id}` : ""})</span></span>
              <span className="spacer" />
              <button className="ghost small" onClick={() => disconnect(r)}>Disconnect</button>
            </div>
          ))}
          <p className="small muted" style={{ marginBottom: 0 }}>
            Students who click the Research Suite activity in Moodle are signed in and added to this class automatically. The first time you click it,
            you&apos;ll be asked to sign in once to connect your Moodle account.
          </p>
        </div>
      ) : (
        !open && <p className="small muted" style={{ marginBottom: 0 }}>Let students open Research Suite from your Moodle course, already signed in and in this class.</p>
      )}
      {open && (
        <div className="moodle-steps">
          <h4>Step 1 · In Moodle, add the tool</h4>
          <p className="small muted">
            In your Moodle course, open <b>More → LTI External tools</b> and click <b>Add tool</b>. Choose <b>LTI 1.3</b> first, then fill in:
          </p>
          <table className="list">
            <tbody>
              {values.map(([label, value, key]) => (
                <tr key={label}>
                  <td style={{ whiteSpace: "nowrap" }}>{label}</td>
                  <td><code className="join-link">{value}</code></td>
                  <td>{key && <button className="small" onClick={() => copy(value, key)}>{copied === key ? "Copied" : "Copy"}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">
            Click <b>Show more…</b> or <b>Expand all</b> to see every section. Under <b>Privacy</b>, set <b>Share launcher&apos;s name with tool</b> to
            <b> Always</b> (so your roster shows names). Leave email sharing and the services off. Then click <b>Save changes</b>.
          </p>
          <p className="small muted">
            Back on the LTI External tools list, turn on <b>Show in activity chooser</b> for Research Suite.
          </p>
          <h4>Step 2 · Paste Moodle&apos;s details here</h4>
          <p className="small muted">
            In the LTI External tools list, open Research Suite&apos;s <b>Actions</b> menu and choose <b>Edit</b>. Copy the <b>Client ID</b> (in a grey box near
            the top) and paste it below with your Moodle&apos;s web address.
          </p>
          <form onSubmit={save} className="fields" style={{ gridTemplateColumns: "1fr" }}>
            <label className="field"><span>Your Moodle&apos;s web address (Platform ID)</span><input type="text" value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="https://moodle.yourschool.edu" aria-label="Moodle address" /></label>
            <div className="fields">
              <label className="field"><span>Client ID</span><input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client ID" /></label>
              <label className="field"><span>Deployment ID (optional; leave blank unless an administrator gives you one)</span><input type="text" value={deploymentId} onChange={(e) => setDeploymentId(e.target.value)} aria-label="Deployment ID" /></label>
            </div>
            {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
            <div className="row">
              <button type="submit" className="primary" disabled={busy}>{busy ? "Connecting…" : "Connect"}</button>
              <button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </form>
          <h4>Step 3 · Add the activity</h4>
          <p className="small muted" style={{ marginBottom: 0 }}>
            In Moodle, turn editing on, click <b>Add an activity or resource</b>, and choose the <b>Research Suite</b> tile.
          </p>
        </div>
      )}
    </section>
  );
}
