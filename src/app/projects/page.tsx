"use client";
// Your own projects. For teachers, a place to try the tools as a writer;
// signed out, a try-it-on-this-computer mode.
import ProjectsView from "@/components/ProjectsView";
import SiteHeader from "@/components/SiteHeader";
import { useSession } from "@/lib/cloud";

export default function ProjectsPage() {
  const { account, role } = useSession();
  if (account === undefined || (account && !role)) return <main className="home"><p className="muted">Loading…</p></main>;
  return (
    <>
      <SiteHeader account={account} role={role} active="projects" />
      <main className="home wide">
        {role === "teacher" && (
          <p className="small muted" style={{ marginTop: 0 }}>
            Your own writing projects, for getting to know the tools. Students never see these.
          </p>
        )}
        <ProjectsView account={account} role={role} heading="My projects" />
      </main>
    </>
  );
}
