// Browser storage (IndexedDB). Version 0.1 keeps everything on the student's
// own device; cloud accounts come in a later milestone. Export/import lets
// students submit their recording through Moodle as a file.
"use client";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Project, RecEvent, Reflection } from "./types";

interface SuiteDB extends DBSchema {
  projects: { key: string; value: Project };
  events: { key: [string, number]; value: { projectId: string; seq: number; e: RecEvent } };
  reflections: { key: string; value: Reflection; indexes: { byProject: string } };
  /** The document after the first `seq` events, saved now and then so projects open fast. */
  snapshots: { key: [string, number]; value: { projectId: string; seq: number; doc: Record<string, unknown> } };
}

let dbp: Promise<IDBPDatabase<SuiteDB>> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB<SuiteDB>("research-suite", 2, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore("projects", { keyPath: "id" });
          d.createObjectStore("events", { keyPath: ["projectId", "seq"] });
          const r = d.createObjectStore("reflections", { keyPath: "id" });
          r.createIndex("byProject", "projectId");
        }
        if (oldVersion < 2) d.createObjectStore("snapshots", { keyPath: ["projectId", "seq"] });
      },
    });
  }
  return dbp;
}

export function newId() {
  return crypto.randomUUID();
}

export async function listProjects(): Promise<Project[]> {
  const all = await (await db()).getAll("projects");
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string) {
  return (await db()).get("projects", id);
}

export async function putProject(p: Project) {
  await (await db()).put("projects", p);
}

export async function createProject(title: string, owner?: string, link: { classId?: string; kitId?: string } = {}): Promise<Project> {
  const now = Date.now();
  const p: Project = {
    id: newId(),
    title,
    createdAt: now,
    updatedAt: now,
    doc: null,
    wordCount: 0,
    eventCount: 0,
    ...(owner ? { owner } : {}),
    ...(link.classId ? { classId: link.classId } : {}),
    ...(link.kitId ? { kitId: link.kitId } : {}),
  };
  await putProject(p);
  return p;
}

export async function deleteProject(id: string) {
  const d = await db();
  const tx = d.transaction(["projects", "events", "reflections", "snapshots"], "readwrite");
  await tx.objectStore("projects").delete(id);
  await tx.objectStore("events").delete(IDBKeyRange.bound([id, 0], [id, Infinity]));
  await tx.objectStore("snapshots").delete(IDBKeyRange.bound([id, 0], [id, Infinity]));
  const refs = await tx.objectStore("reflections").index("byProject").getAllKeys(id);
  for (const k of refs) await tx.objectStore("reflections").delete(k);
  await tx.done;
}

export async function appendEvents(projectId: string, startSeq: number, events: RecEvent[]) {
  const d = await db();
  const tx = d.transaction("events", "readwrite");
  events.forEach((e, i) => tx.store.put({ projectId, seq: startSeq + i, e }));
  await tx.done;
}

export async function getEvents(projectId: string): Promise<RecEvent[]> {
  const rows = await (await db()).getAll("events", IDBKeyRange.bound([projectId, 0], [projectId, Infinity]));
  return rows.map((r) => r.e);
}

export async function countEvents(projectId: string): Promise<number> {
  return (await db()).count("events", IDBKeyRange.bound([projectId, 0], [projectId, Infinity]));
}

/** Events from sequence number `fromSeq` onward. */
export async function getEventsFrom(projectId: string, fromSeq: number): Promise<RecEvent[]> {
  const rows = await (await db()).getAll("events", IDBKeyRange.bound([projectId, fromSeq], [projectId, Infinity]));
  return rows.map((r) => r.e);
}

/** Remove recorded events and snapshots from `fromSeq` onward (used when the cloud copy wins). */
export async function truncateRecording(projectId: string, fromSeq: number) {
  const d = await db();
  const tx = d.transaction(["events", "snapshots"], "readwrite");
  await tx.objectStore("events").delete(IDBKeyRange.bound([projectId, fromSeq], [projectId, Infinity]));
  await tx.objectStore("snapshots").delete(IDBKeyRange.bound([projectId, fromSeq + 1], [projectId, Infinity]));
  await tx.done;
}

export async function putSnapshot(projectId: string, seq: number, doc: Record<string, unknown>) {
  await (await db()).put("snapshots", { projectId, seq, doc });
}

/** The newest snapshot taken at or before `maxSeq` events. */
export async function latestSnapshot(projectId: string, maxSeq = Infinity) {
  const d = await db();
  const cursor = await d.transaction("snapshots").store.openCursor(IDBKeyRange.bound([projectId, 0], [projectId, maxSeq]), "prev");
  return cursor?.value ?? null;
}

export async function getSnapshots(projectId: string) {
  return (await db()).getAll("snapshots", IDBKeyRange.bound([projectId, 0], [projectId, Infinity]));
}

export async function getReflections(projectId: string): Promise<Reflection[]> {
  const rows = await (await db()).getAllFromIndex("reflections", "byProject", projectId);
  return rows.sort((a, b) => a.at - b.at || a.createdAt - b.createdAt);
}

export async function putReflection(r: Reflection) {
  await (await db()).put("reflections", r);
}

export async function deleteReflection(id: string) {
  await (await db()).delete("reflections", id);
}

// ---------- Export / import (a single portable file) ----------

const FORMAT = "research-suite-project";

async function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}

export async function exportProject(id: string, author?: string): Promise<Blob> {
  const p = await getProject(id);
  if (!p) throw new Error("Project not found");
  const events = await getEvents(id);
  const refs = await getReflections(id);
  const reflections = await Promise.all(
    refs.map(async (r) => ({ ...r, audio: r.audio ? await blobToDataUrl(r.audio) : undefined })),
  );
  const payload = { format: FORMAT, version: 1, exportedAt: Date.now(), project: { ...p, author: author || p.author }, events, reflections };
  const json = new Blob([JSON.stringify(payload)], { type: "application/json" });
  if (typeof CompressionStream === "undefined") return json;
  // Compressed: a month-long project shrinks roughly tenfold.
  return new Response(json.stream().pipeThrough(new CompressionStream("gzip"))).blob();
}

async function readProjectFile(file: Blob): Promise<unknown> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const gzipped = head[0] === 0x1f && head[1] === 0x8b;
  if (!gzipped) return JSON.parse(await file.text());
  if (typeof DecompressionStream === "undefined") throw new Error("This browser can't open compressed project files. Try a current Chrome, Edge, Safari or Firefox.");
  return JSON.parse(await new Response(file.stream().pipeThrough(new DecompressionStream("gzip"))).text());
}

export async function importProject(file: File): Promise<Project> {
  let data: { format?: string; project: Project; events: RecEvent[]; reflections: (Reflection & { audio?: string })[] };
  try {
    data = (await readProjectFile(file)) as typeof data;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("This browser")) throw e;
    throw new Error("This file is not a Research Suite project.");
  }
  if (data?.format !== FORMAT) throw new Error("This file is not a Research Suite project.");
  const id = newId();
  const p: Project = { ...data.project, id, imported: true, updatedAt: Date.now() };
  await putProject(p);
  await appendEvents(id, 0, data.events);
  for (const r of data.reflections) {
    const audio = r.audio ? await (await fetch(r.audio)).blob() : undefined;
    await putReflection({ ...r, id: newId(), projectId: id, audio });
  }
  return p;
}
