"use client";
import { useParams } from "next/navigation";
import Writer from "@/components/Writer";

export default function WritePage() {
  const { id } = useParams<{ id: string }>();
  return <Writer key={id} projectId={id} />;
}
