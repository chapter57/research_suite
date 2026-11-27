// Server side: find the kit the coach should use for a request, reading the
// database as the signed-in user (so the usual security rules apply).
import { cloud } from "@/config/cloud";
import { cleanKit, generalWriting, type KitContent } from "./kits";

async function readAs<T>(token: string, path: string): Promise<T[]> {
  const res = await fetch(`${cloud.url}/rest/v1/${path}`, {
    headers: { apikey: cloud.publishableKey, Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Couldn't read the course kit (${res.status}).`);
  return (await res.json()) as T[];
}

export class KitAccessError extends Error {}

export async function resolveKit(opts: { token?: string | null; classId?: string; kitId?: string; kit?: unknown }): Promise<KitContent> {
  const { token, classId, kitId, kit } = opts;
  if (kit !== undefined) {
    // A teacher testing a kit they're editing.
    if (!token) throw new KitAccessError("Sign in as a teacher to test a kit.");
    const rows = await readAs<{ user_id: string }>(token, "instructors?select=user_id");
    if (!rows.length) throw new KitAccessError("Only teachers can test kits.");
    return cleanKit(kit);
  }
  if (classId && token) {
    const rows = await readAs<{ kit: unknown }>(token, `classes?id=eq.${encodeURIComponent(classId)}&select=kit`);
    if (rows[0]?.kit) return cleanKit(rows[0].kit);
  }
  if (kitId && token) {
    const rows = await readAs<{ content: unknown }>(token, `kits?id=eq.${encodeURIComponent(kitId)}&select=content`);
    if (rows[0]?.content) return cleanKit(rows[0].content);
  }
  return generalWriting;
}
