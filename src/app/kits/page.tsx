"use client";
import Link from "next/link";
import KitShelf from "@/components/KitShelf";
import SiteHeader from "@/components/SiteHeader";
import { useSession } from "@/lib/cloud";

export default function KitsPage() {
  const { account, role } = useSession();
  if (account === undefined || (account && !role)) return <main className="home"><p className="muted">Loading…</p></main>;
  if (!account || role !== "teacher") return <main className="home"><p>Course kits are for teacher accounts. <Link href="/">Go home</Link></p></main>;
  return (
    <>
      <SiteHeader account={account} role={role} active="kits" />
      <main className="home wide"><KitShelf account={account} /></main>
    </>
  );
}
