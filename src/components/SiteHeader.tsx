"use client";
// The bar at the top of every home-area page: brand, the role's sections, account.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signOutOnly, type Account, type Role } from "@/lib/cloud";
import { allSynced, forgetLocal, syncAll } from "@/lib/sync";

export type Section = "teaching" | "kits" | "projects" | "home";

export default function SiteHeader({ account, role, active }: { account: Account | null; role?: Role; active: Section }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (!account) return;
    setBusy(true);
    try {
      await syncAll(account).catch(() => {});
      if (!(await allSynced(account))) {
        const ok = confirm(
          "Some of your recent work hasn't reached the cloud yet (are you offline?). If you sign out now, that work stays only on this computer and won't be in your account. Sign out anyway?",
        );
        if (!ok) return;
      } else {
        // Shared computers: remove this account's copies; they're safe in the cloud.
        await forgetLocal(account);
      }
      await signOutOnly();
      router.push("/");
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="site-header">
      <Link href="/" className="brand">Research Suite</Link>
      {account && role === "teacher" && (
        <nav className="tabs" aria-label="Sections">
          <Link href="/" className={active === "teaching" ? "tab on" : "tab"}>Teaching</Link>
          <Link href="/kits" className={active === "kits" ? "tab on" : "tab"}>Course kits</Link>
          <Link href="/projects" className={active === "projects" ? "tab on" : "tab"}>My projects</Link>
        </nav>
      )}
      <span className="spacer" />
      {account ? (
        <div className="who">
          <span className="who-name">{account.name}</span>
          {role && <span className={`role-chip ${role}`}>{role === "teacher" ? "Teacher" : "Student"}</span>}
          <button className="ghost small" onClick={signOut} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button>
        </div>
      ) : (
        <Link href="/"><button className="small">Sign in</button></Link>
      )}
    </header>
  );
}
