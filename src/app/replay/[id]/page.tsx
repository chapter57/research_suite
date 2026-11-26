"use client";
import { useParams } from "next/navigation";
import Player from "@/components/Player";

export default function ReplayPage() {
  const { id } = useParams<{ id: string }>();
  return <Player key={id} projectId={id} />;
}
