"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PlayerInner } from "@/components/Player";
import { loadTurnedIn, type TurnedInWork } from "@/lib/classes";
import { useAccount } from "@/lib/cloud";

export default function ReviewPage() {
  const { classId, projectId } = useParams<{ classId: string; projectId: string }>();
  const account = useAccount();
  const [work, setWork] = useState<TurnedInWork | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!account) return;
    loadTurnedIn(classId, projectId).then(setWork).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [account, classId, projectId]);

  if (account === null) return <main className="home"><p>Please <Link href="/">sign in</Link> first.</p></main>;
  if (error) return <main className="home"><p className="error">{error}</p><Link href={`/class/${classId}`}>Back to class</Link></main>;
  if (!work) return <main className="home"><p className="muted">Loading turned-in work…</p></main>;

  const s = work.submission;
  return (
    <PlayerInner
      key={projectId + s.turned_in_at}
      project={work.project}
      events={work.events}
      reflections={work.reflections}
      snapshots={work.snapshots}
      review={{
        backHref: `/class/${classId}`,
        banner: (
          <>
            Turned in by <b>{work.student?.student_name || work.project.author || "a student"}</b> on {new Date(s.turned_in_at).toLocaleString()} ·{" "}
            {s.word_count.toLocaleString()} words. You&apos;re seeing it exactly as it was turned in; you can&apos;t change it.
          </>
        ),
      }}
    />
  );
}
