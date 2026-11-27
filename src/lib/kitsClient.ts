"use client";
// Course kits in the browser: a teacher's shelf, plugging a kit into a class,
// and working out which kit the coach uses for a project.
import { sb, type Account } from "./cloud";
import { check } from "./sync";
import { cleanKit, generalWriting, type ClassKit, type KitContent } from "./coach/kits";

export interface KitRow {
  id: string;
  content: KitContent;
  version: number;
  created_at: string;
  updated_at: string;
}

export async function myKits(account: Account): Promise<KitRow[]> {
  const rows = check(await sb().from("kits").select("*").eq("owner", account.id).order("updated_at", { ascending: false })) as KitRow[];
  return rows.map((r) => ({ ...r, content: cleanKit(r.content) }));
}

export async function getKit(id: string): Promise<KitRow | null> {
  const rows = check(await sb().from("kits").select("*").eq("id", id)) as KitRow[];
  return rows[0] ? { ...rows[0], content: cleanKit(rows[0].content) } : null;
}

export async function createKit(content: KitContent): Promise<KitRow> {
  const res = await sb().from("kits").insert({ content: cleanKit(content) }).select("*").single();
  if (res.error) throw new Error(res.error.message);
  return res.data as KitRow;
}

/** Save edits. Classes already using the kit keep their own frozen copy. */
export async function saveKit(row: KitRow, content: KitContent): Promise<KitRow> {
  const res = await sb()
    .from("kits")
    .update({ content: cleanKit(content), version: row.version + 1, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .select("*")
    .single();
  if (res.error) throw new Error(res.error.message);
  return res.data as KitRow;
}

export async function deleteKit(id: string) {
  check(await sb().from("kits").delete().eq("id", id));
}

export function frozenCopy(row: KitRow): ClassKit {
  return { ...cleanKit(row.content), kitId: row.id, version: row.version };
}

/** Plug a kit into a class (refused by the database once students have joined). */
export async function plugKit(classId: string, row: KitRow) {
  const res = await sb().from("classes").update({ kit: frozenCopy(row) }).eq("id", classId);
  if (res.error) throw new Error(/locked/i.test(res.error.message) ? "This class's kit is locked because students have joined." : res.error.message);
}

export async function classKit(classId: string): Promise<ClassKit | null> {
  const rows = check(await sb().from("classes").select("kit").eq("id", classId)) as { kit: ClassKit | null }[];
  return rows[0]?.kit ? ({ ...cleanKit(rows[0].kit), kitId: rows[0].kit.kitId ?? null, version: rows[0].kit.version ?? 1 } as ClassKit) : null;
}

/** Which kit the coach uses for a project: its class's, the teacher's chosen kit, or general writing. */
export async function kitForProject(p: { classId?: string; kitId?: string }): Promise<KitContent> {
  try {
    if (p.classId) {
      const k = await classKit(p.classId);
      if (k) return k;
    }
    if (p.kitId) {
      const k = await getKit(p.kitId);
      if (k) return k.content;
    }
  } catch {
    /* offline: fall back */
  }
  return generalWriting;
}

export async function accessToken(): Promise<string | null> {
  const { data } = await sb().auth.getSession();
  return data.session?.access_token ?? null;
}
