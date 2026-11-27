"use client";
// Home: a welcome page when signed out; otherwise the area for your role.
import { useRouter } from "next/navigation";
import Landing from "@/components/Landing";
import ProjectsView from "@/components/ProjectsView";
import SiteHeader from "@/components/SiteHeader";
import StudentClasses from "@/components/StudentClasses";
import TeacherClasses from "@/components/TeacherClasses";
import { useSession } from "@/lib/cloud";

export default function Home() {
  const { account, role } = useSession();
  const router = useRouter();

  if (account === undefined || (account && !role)) return <main className="home"><p className="muted">Loading…</p></main>;
  if (!account) return <Landing onSignedIn={() => router.refresh()} />;

  if (role === "teacher") {
    return (
      <>
        <SiteHeader account={account} role={role} active="teaching" />
        <main className="home wide">
          <TeacherClasses account={account} />
        </main>
      </>
    );
  }
  return (
    <>
      <SiteHeader account={account} role={role} active="home" />
      <main className="home wide">
        <p className="greeting">Welcome back, {account.name.split(" ")[0]}.</p>
        <ProjectsView account={account} role="student" heading="My projects" />
        <div style={{ height: 28 }} />
        <StudentClasses account={account} />
      </main>
    </>
  );
}
