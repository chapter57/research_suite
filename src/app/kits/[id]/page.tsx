"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import KitEditor from "@/components/KitEditor";
import SiteHeader from "@/components/SiteHeader";
import { useSession } from "@/lib/cloud";

export default function KitPage() {
  const { id } = useParams<{ id: string }>();
  const { account, role } = useSession();
  if (account === undefined || (account && !role)) return <main className="home"><p className="muted">Loading…</p></main>;
  if (!account || role !== "teacher") return <main className="home"><p>Course kits are for teacher accounts. <Link href="/">Go home</Link></p></main>;
  return (
    <>
      <SiteHeader account={account} role={role} active="kits" />
      <KitEditor key={id} kitId={id} />
    </>
  );
}
