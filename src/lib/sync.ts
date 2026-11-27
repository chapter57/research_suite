"use client";
// Keeps projects in this browser and in the cloud in step.
//
// The browser stays the working copy (fast, works offline). When signed in,
// new recording events, the latest snapshot, metadata and reflections are
// uploaded in the background, and projects written on another computer are
// downloaded. The recording is uploaded as chunks of consecutive events; the
// last event is always re-sent next time, because the word being typed may
// still change.
import { sb, type Account } from "./cloud";
import {
  appendEvents,
  countEvents,
  deleteProject as deleteLocal,
  getEventsFrom,
  getProject,
  getReflections,
  latestSnapshot,
  listProjects,
  newId,
  putProject,
  putReflection,
  putSnapshot,
  truncateRecording,
} from "./store";
import type { Project, RecEvent, Reflection } from "./types";

const CHUNK = 1500; // events per uploaded chunk
const PAGE = 100; // chunks per download request

let queue: Promise<unknown> = Promise.resolve();
/** Run sync jobs one at a time. */
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** Projects on this computer that this account may see. */
export function visibleTo(p: Project, account: Account | null) {
  return p.imported || !p.owner || p.owner === account?.id;
}

// ---------------- Upload ----------------

async function pushOne(id: string, account: Account) {
  const p = await getProject(id);
  if (!p || p.imported || (p.owner && p.owner !== account.id)) return;
  const total = await countEvents(id);
  const synced = p.syncedThrough ?? 0;
  const snap = await latestSnapshot(id, total);
  const snapNew = snap && snap.seq > (p.snapPushedSeq ?? -1);

  check(
    await sb()
      .from("projects")
      .upsert({
        id,
        owner: account.id,
        title: p.title,
        doc: p.doc,
        word_count: p.wordCount,
        event_count: Math.max(total, synced),
        author: p.author ?? null,
        mla: p.mla ?? null,
        updated_at: new Date(p.updatedAt).toISOString(),
        ...(snapNew ? { snapshot_seq: snap.seq, snapshot_doc: snap.doc } : {}),
      }),
  );

  // Recording: resend from one before the last synced event.
  const start = Math.max(0, synced - 1);
  const events = total > start ? await getEventsFrom(id, start) : [];
  for (let i = 0; i < events.length; i += CHUNK) {
    check(await sb().from("event_chunks").upsert({ project_id: id, start_seq: start + i, events: events.slice(i, i + CHUNK) }));
  }

  // Reflections not uploaded yet (voice notes go to private storage).
  for (const r of await getReflections(id)) {
    if (r.synced) continue;
    let audioPath: string | null = null;
    if (r.audio) {
      audioPath = `${account.id}/${id}/${r.id}`;
      check(await sb().storage.from("voice-notes").upload(audioPath, r.audio, { upsert: true, contentType: r.audio.type || "audio/webm" }));
    }
    check(
      await sb().from("reflections").upsert({
        id: r.id,
        project_id: id,
        at: r.at,
        kind: r.kind,
        text: r.text ?? null,
        audio_path: audioPath,
        duration_ms: r.durationMs ?? null,
        created_at: new Date(r.createdAt).toISOString(),
      }),
    );
    await putReflection({ ...r, synced: true });
  }

  const latest = (await getProject(id)) ?? p;
  const newSynced = events.length ? start + events.length : synced;
  await putProject({ ...latest, owner: account.id, syncedThrough: newSynced, snapPushedSeq: snapNew ? snap.seq : p.snapPushedSeq });
}

// ---------------- Download ----------------

interface CloudProject {
  id: string;
  title: string;
  doc: Record<string, unknown> | null;
  word_count: number;
  event_count: number;
  author: string | null;
  mla: Project["mla"] | null;
  snapshot_seq: number | null;
  snapshot_doc: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

async function downloadEvents(id: string, fromSeq: number): Promise<{ start: number; events: RecEvent[] }> {
  const placed = new Map<number, RecEvent>();
  for (let page = 0; ; page++) {
    const rows = check(
      await sb()
        .from("event_chunks")
        .select("start_seq, events")
        .eq("project_id", id)
        .gte("start_seq", fromSeq)
        .order("start_seq")
        .range(page * PAGE, page * PAGE + PAGE - 1),
    ) as { start_seq: number; events: RecEvent[] }[];
    // Later chunks overwrite the overlapping end of earlier ones.
    for (const row of rows) row.events.forEach((e, i) => placed.set(row.start_seq + i, e));
    if (rows.length < PAGE) break;
  }
  if (!placed.size) return { start: fromSeq, events: [] };
  const start = Math.min(...placed.keys());
  const end = Math.max(...placed.keys());
  const events: RecEvent[] = [];
  for (let i = start; i <= end; i++) {
    const e = placed.get(i);
    if (!e) throw new Error("The cloud copy of this recording has a gap.");
    events.push(e);
  }
  return { start, events };
}

async function downloadReflections(id: string, account: Account) {
  const rows = check(await sb().from("reflections").select("*").eq("project_id", id)) as {
    id: string;
    at: number;
    kind: "text" | "audio";
    text: string | null;
    audio_path: string | null;
    duration_ms: number | null;
    created_at: string;
  }[];
  const have = new Set((await getReflections(id)).map((r) => r.id));
  for (const row of rows) {
    if (have.has(row.id)) continue;
    let audio: Blob | undefined;
    if (row.audio_path) {
      const res = await sb().storage.from("voice-notes").download(row.audio_path);
      if (!res.error) audio = res.data;
    }
    const r: Reflection = {
      id: row.id,
      projectId: id,
      at: row.at,
      kind: row.kind,
      text: row.text ?? undefined,
      audio,
      durationMs: row.duration_ms ?? undefined,
      createdAt: Date.parse(row.created_at),
      synced: true,
    };
    await putReflection(r);
  }
  void account;
}

function fromCloud(c: CloudProject, account: Account, local?: Project): Project {
  return {
    ...(local ?? {}),
    id: c.id,
    title: c.title,
    createdAt: local?.createdAt ?? Date.parse(c.created_at),
    updatedAt: Date.parse(c.updated_at),
    doc: c.doc,
    wordCount: c.word_count,
    eventCount: c.event_count,
    author: c.author ?? undefined,
    mla: c.mla ?? undefined,
    owner: account.id,
    syncedThrough: c.event_count,
    snapPushedSeq: c.snapshot_seq ?? undefined,
  };
}

/** Keep unsynced local work as a separate project before taking the cloud version. */
async function keepLocalCopy(p: Project) {
  const copyId = newId();
  const events = await getEventsFrom(p.id, 0);
  await putProject({ ...p, id: copyId, title: `${p.title} (copy from this computer)`, owner: undefined, syncedThrough: 0, snapPushedSeq: undefined, updatedAt: Date.now() });
  await appendEvents(copyId, 0, events);
  for (const r of await getReflections(p.id)) await putReflection({ ...r, id: newId(), projectId: copyId, synced: false });
  return copyId;
}

async function pullOne(c: CloudProject, account: Account): Promise<"new" | "updated" | "same" | "conflict"> {
  const local = await getProject(c.id);
  if (local && local.owner && local.owner !== account.id) return "same";
  if (!local) {
    const { events } = await downloadEvents(c.id, 0);
    await putProject(fromCloud({ ...c, event_count: events.length }, account));
    await appendEvents(c.id, 0, events);
    if (c.snapshot_seq != null && c.snapshot_doc && c.snapshot_seq <= events.length) await putSnapshot(c.id, c.snapshot_seq, c.snapshot_doc);
    await downloadReflections(c.id, account);
    return "new";
  }
  const total = await countEvents(c.id);
  const synced = local.syncedThrough ?? 0;
  let result: "updated" | "same" | "conflict" = "same";
  if (c.event_count > synced) {
    // Another computer added to this project.
    if (total > synced && local.owner) {
      await keepLocalCopy(local);
      result = "conflict";
    } else result = "updated";
    const from = Math.max(0, synced - 1);
    const { start, events } = await downloadEvents(c.id, from);
    // Drop this computer's unsynced events (kept in the copy above) and replace them with the cloud's.
    await truncateRecording(c.id, Math.min(start, total));
    if (events.length) await appendEvents(c.id, start, events);
    const newTotal = Math.max(start + events.length, from);
    if (c.snapshot_seq != null && c.snapshot_doc && c.snapshot_seq <= newTotal) await putSnapshot(c.id, c.snapshot_seq, c.snapshot_doc);
    await putProject(fromCloud({ ...c, event_count: newTotal }, account, local));
  } else if (Date.parse(c.updated_at) > local.updatedAt + 1000 && total <= synced) {
    await putProject({ ...local, title: c.title, mla: c.mla ?? local.mla, author: c.author ?? local.author, owner: account.id });
    result = "updated";
  }
  await downloadReflections(c.id, account);
  return result;
}

// ---------------- Public API ----------------

export interface SyncResult {
  downloaded: number;
  conflicts: number;
}

/** Download what's new in the cloud, then upload what's new here. */
export function syncAll(account: Account): Promise<SyncResult> {
  return serial(async () => {
    const cloudList = check(await sb().from("projects").select("*")) as CloudProject[];
    const result: SyncResult = { downloaded: 0, conflicts: 0 };
    const inCloud = new Set(cloudList.map((c) => c.id));
    for (const c of cloudList) {
      const r = await pullOne(c, account);
      if (r === "new") result.downloaded++;
      if (r === "conflict") result.conflicts++;
    }
    for (const p of await listProjects()) {
      if (p.imported || (p.owner && p.owner !== account.id)) continue;
      // Uploaded before but gone from the cloud: deleted on another computer.
      if (p.owner === account.id && (p.syncedThrough ?? 0) > 0 && !inCloud.has(p.id)) {
        await deleteLocal(p.id);
        continue;
      }
      await pushOne(p.id, account);
    }
    return result;
  });
}

/** Before opening a project: bring in anything written on another computer. */
export function pullProject(id: string, account: Account) {
  return serial(async () => {
    const rows = check(await sb().from("projects").select("*").eq("id", id)) as CloudProject[];
    if (rows[0]) return pullOne(rows[0], account);
    return "same" as const;
  });
}

export function pushProject(id: string, account: Account) {
  return serial(() => pushOne(id, account));
}

export function deleteFromCloud(id: string, account: Account) {
  return serial(async () => {
    const files = await sb().storage.from("voice-notes").list(`${account.id}/${id}`);
    if (files.data?.length) await sb().storage.from("voice-notes").remove(files.data.map((f) => `${account.id}/${id}/${f.name}`));
    check(await sb().from("projects").delete().eq("id", id));
  });
}

export function deleteReflectionFromCloud(id: string) {
  return serial(async () => {
    const rows = check(await sb().from("reflections").select("audio_path").eq("id", id)) as { audio_path: string | null }[];
    if (rows[0]?.audio_path) await sb().storage.from("voice-notes").remove([rows[0].audio_path]);
    check(await sb().from("reflections").delete().eq("id", id));
  });
}

/** Everything uploaded? Used before signing out. */
export async function allSynced(account: Account): Promise<boolean> {
  for (const p of await listProjects()) {
    if (p.owner !== account.id) continue;
    if ((await countEvents(p.id)) > (p.syncedThrough ?? 0)) return false;
    if ((await getReflections(p.id)).some((r) => !r.synced)) return false;
  }
  return true;
}

/** Remove this account's projects from this computer (they stay in the cloud). */
export async function forgetLocal(account: Account) {
  for (const p of await listProjects()) if (p.owner === account.id) await deleteLocal(p.id);
}
