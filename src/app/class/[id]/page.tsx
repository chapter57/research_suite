"use client";
import { useParams } from "next/navigation";
import ClassPage from "@/components/ClassPage";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <ClassPage key={id} classId={id} />;
}
