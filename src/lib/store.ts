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
}

let dbp: Promise<IDBPDatabase<SuiteDB>> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB<SuiteDB>("research-suite", 1, {
      upgrade(d) {
        d.createObjectStore("projects", { keyPath: "id" });
        d.createObjectStore("events", { keyPath: ["projectId", "seq"] });
        const r = d.createObjectStore("reflections", { keyPath: "id" });
        r.createIndex("byProject", "projectId");
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

export async function createProject(title: string): Promise<Project> {
  const now = Date.now();
  const p: Project = { id: newId(), title, createdAt: now, updatedAt: now, doc: null, wordCount: 0, eventCount: 0 };
  await putProject(p);
  return p;
}

export async function deleteProject(id: string) {
  const d = await db();
  const tx = d.transaction(["projects", "events", "reflections"], "readwrite");
  await tx.objectStore("projects").delete(id);
  await tx.objectStore("events").delete(IDBKeyRange.bound([id, 0], [id, Infinity]));
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
  return new Blob([JSON.stringify(payload)], { type: "application/json" });
}

export async function importProject(file: File): Promise<Project> {
  const data = JSON.parse(await file.text());
  if (data?.format !== FORMAT) throw new Error("This file is not a Research Suite project.");
  const id = newId();
  const src = data.project as Project;
  const p: Project = { ...src, id, imported: true, updatedAt: Date.now() };
  await putProject(p);
  await appendEvents(id, 0, data.events as RecEvent[]);
  for (const r of data.reflections as (Reflection & { audio?: string })[]) {
    const audio = r.audio ? await (await fetch(r.audio)).blob() : undefined;
    await putReflection({ ...r, id: newId(), projectId: id, audio });
  }
  return p;
}
