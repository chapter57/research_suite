"use client";
// Classes: instructors create them, students join with a code and turn work in.
// An instructor sees a student's project only once it is turned in, read-only,
// and only up to the point it was turned in.
import { sb, type Account } from "./cloud";
import { getProject } from "./store";
import { check, downloadEvents, fetchReflections, pushProject, type CloudProject } from "./sync";
import { catalogTitle, type ClassKit } from "./coach/kits";
import type { Project, RecEvent, Reflection } from "./types";

export interface ClassInfo {
  id: string;
  name: string;
  code: string;
  created_at: string;
  kit?: ClassKit | null;
}
export interface Enrollment {
  class_id: string;
  student: string;
  student_name: string;
  student_email: string;
  joined_at: string;
}
export interface Submission {
  class_id: string;
  project_id: string;
  student: string;
  title: string;
  event_count: number;
  word_count: number;
  turned_in_at: string;
}

export async function isInstructor(account: Account): Promise<boolean> {
  const rows = check(await sb().from("instructors").select("user_id").eq("user_id", account.id)) as unknown[];
  return rows.length > 0;
}

/** "English 102: Composition and Critical Reading · Maymester 2027" */
export function classDisplayName(section: string, kit: ClassKit | null | undefined): string {
  return kit ? `${catalogTitle(kit)} · ${section}` : section;
}

// ---------- Instructor ----------

export async function classesITeach(account: Account): Promise<ClassInfo[]> {
  return check(await sb().from("classes").select("id, name, code, created_at, kit").eq("teacher", account.id).order("created_at")) as ClassInfo[];
}

const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I
function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_LETTERS[b % CODE_LETTERS.length]).join("");
}

export async function createClass(name: string, kit: ClassKit | null): Promise<ClassInfo> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await sb().from("classes").insert({ name: name.trim(), code: newCode(), kit }).select("id, name, code, created_at, kit").single();
    if (!res.error) return res.data as ClassInfo;
    if (res.error.code !== "23505") throw new Error(res.error.message); // 23505 = code already used
  }
  throw new Error("Couldn't create a unique class code. Please try again.");
}

export async function getClass(id: string): Promise<ClassInfo | null> {
  const rows = check(await sb().from("classes").select("id, name, code, created_at, kit").eq("id", id)) as ClassInfo[];
  return rows[0] ?? null;
}

export async function roster(classId: string): Promise<Enrollment[]> {
  return check(await sb().from("enrollments").select("*").eq("class_id", classId).order("student_name")) as Enrollment[];
}

export async function removeStudent(classId: string, student: string) {
  // Their turned-in work leaves the class with them.
  check(await sb().from("submissions").delete().eq("class_id", classId).eq("student", student));
  check(await sb().from("enrollments").delete().eq("class_id", classId).eq("student", student));
}

export async function classSubmissions(classId: string): Promise<Submission[]> {
  return check(await sb().from("submissions").select("*").eq("class_id", classId).order("turned_in_at", { ascending: false })) as Submission[];
}

export interface TurnedInWork {
  project: Project;
  events: RecEvent[];
  reflections: Reflection[];
  snapshots: { seq: number; doc: Record<string, unknown> }[];
  submission: Submission;
  student: Enrollment | null;
}

/** Load a turned-in project for review, exactly as it stood when turned in. */
export async function loadTurnedIn(classId: string, projectId: string): Promise<TurnedInWork> {
  const subs = check(await sb().from("submissions").select("*").eq("class_id", classId).eq("project_id", projectId)) as Submission[];
  const submission = subs[0];
  if (!submission) throw new Error("This work hasn't been turned in to this class.");
  const rows = check(await sb().from("projects").select("*").eq("id", projectId)) as CloudProject[];
  const c = rows[0];
  if (!c) throw new Error("This project is no longer available.");
  const { events: all } = await downloadEvents(projectId, 0);
  const events = all.slice(0, submission.event_count);
  const reflections = (await fetchReflections(projectId)).filter((r) => r.at <= events.length);
  const snapshots = c.snapshot_seq != null && c.snapshot_doc && c.snapshot_seq <= events.length ? [{ seq: c.snapshot_seq, doc: c.snapshot_doc }] : [];
  const people = check(await sb().from("enrollments").select("*").eq("class_id", classId).eq("student", submission.student)) as Enrollment[];
  const project: Project = {
    id: c.id,
    title: submission.title || c.title,
    createdAt: Date.parse(c.created_at),
    updatedAt: Date.parse(submission.turned_in_at),
    doc: c.doc,
    wordCount: submission.word_count,
    eventCount: events.length,
    author: people[0]?.student_name || c.author || undefined,
    mla: c.mla ?? undefined,
    imported: true,
  };
  return { project, events, reflections, snapshots, submission, student: people[0] ?? null };
}

// ---------- Student ----------

export interface MyClass {
  class_id: string;
  name: string;
  joined_at: string;
}

export async function myClasses(account: Account): Promise<MyClass[]> {
  const rows = check(await sb().from("enrollments").select("class_id, joined_at, classes(name, kit)").eq("student", account.id)) as unknown as {
    class_id: string;
    joined_at: string;
    classes: { name: string; kit: ClassKit | null } | { name: string; kit: ClassKit | null }[] | null;
  }[];
  return rows.map((r) => {
    const c = Array.isArray(r.classes) ? r.classes[0] : r.classes;
    return { class_id: r.class_id, joined_at: r.joined_at, name: classDisplayName(c?.name ?? "Class", c?.kit ?? null) };
  });
}

export async function joinClass(code: string): Promise<{ class_id: string; class_name: string }> {
  const res = await sb().rpc("join_class", { join_code: code.trim() });
  if (res.error) throw new Error(res.error.message.replace(/^.*?:\s*/, "") || "Couldn't join that class.");
  const row = (res.data as { class_id: string; class_name: string }[])[0];
  return row;
}

export async function leaveClass(account: Account, classId: string) {
  // Work turned in to this class is no longer shared once you leave.
  check(await sb().from("submissions").delete().eq("class_id", classId).eq("student", account.id));
  check(await sb().from("enrollments").delete().eq("class_id", classId).eq("student", account.id));
}

export async function submissionsFor(projectId: string): Promise<Submission[]> {
  return check(await sb().from("submissions").select("*").eq("project_id", projectId)) as Submission[];
}

/** Upload the latest work, then turn it in (or update what was turned in). */
export async function turnIn(account: Account, classId: string, projectId: string): Promise<Submission> {
  await pushProject(projectId, account);
  const p = await getProject(projectId);
  if (!p || !p.syncedThrough) throw new Error("Your work hasn't reached the cloud yet. Check your connection and try again.");
  const row = {
    class_id: classId,
    project_id: projectId,
    student: account.id,
    title: p.title,
    event_count: p.syncedThrough,
    word_count: p.wordCount,
    turned_in_at: new Date().toISOString(),
  };
  const res = await sb().from("submissions").upsert(row).select("*").single();
  if (res.error) throw new Error(res.error.message);
  return res.data as Submission;
}
