// LTI 1.3 server side: the database work, using Supabase's secret key.
// Only ever imported by API routes (never in the browser).
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cloud } from "@/config/cloud";
import { placeholderEmail, randomToken, type Launch, type Registration } from "./core";

export function secretKey(): string | null {
  return process.env.SUPABASE_SECRET_KEY || null;
}

/** Key for signing our own short-lived values, derived from the secret key. */
export function signingSecret(): string {
  return createHash("sha256").update(`lti-signing:${secretKey()}`).digest("hex");
}

let admin: SupabaseClient | null = null;
function db(): SupabaseClient {
  const key = secretKey();
  if (!key) throw new Error("Moodle connections aren't set up on the server yet.");
  admin ??= createClient(cloud.url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

export async function findRegistrations(issuer: string, clientId?: string): Promise<Registration[]> {
  let q = db().from("lti_registrations").select("*").eq("issuer", issuer);
  if (clientId) q = q.eq("client_id", clientId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as Registration[];
}

export async function getRegistration(id: string): Promise<Registration | null> {
  const { data, error } = await db().from("lti_registrations").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Registration | null;
}

export async function linkedUser(issuer: string, sub: string): Promise<string | null> {
  const { data, error } = await db().from("lti_users").select("user_id").eq("issuer", issuer).eq("sub", sub).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { user_id: string } | null)?.user_id ?? null;
}

export async function linkUser(issuer: string, sub: string, userId: string) {
  const { error } = await db().from("lti_users").upsert({ issuer, sub, user_id: userId });
  if (error) throw new Error(error.message);
}

/** The Research Suite account for a Moodle student, created on first launch. */
export async function studentAccount(reg: Registration, launch: Launch): Promise<{ id: string; email: string }> {
  const existing = await linkedUser(reg.issuer, launch.sub);
  if (existing) {
    const { data, error } = await db().auth.admin.getUserById(existing);
    if (error || !data.user) throw new Error("Your Research Suite account couldn't be found.");
    if (data.user.user_metadata?.display_name !== launch.name && launch.name !== "Moodle student") {
      await db().auth.admin.updateUserById(existing, { user_metadata: { ...data.user.user_metadata, display_name: launch.name } });
    }
    return { id: existing, email: data.user.email! };
  }
  const email = placeholderEmail(reg.issuer, launch.sub);
  const { data, error } = await db().auth.admin.createUser({
    email,
    email_confirm: true,
    password: randomToken(32),
    user_metadata: { display_name: launch.name, role: "student", via: "moodle" },
  });
  if (error || !data.user) throw new Error(`Couldn't create your account: ${error?.message ?? "unknown error"}`);
  await linkUser(reg.issuer, launch.sub, data.user.id);
  return { id: data.user.id, email };
}

export async function enroll(classId: string, userId: string, name: string) {
  const { error } = await db()
    .from("enrollments")
    .upsert({ class_id: classId, student: userId, student_name: name, student_email: "via Moodle" }, { onConflict: "class_id,student" });
  if (error) throw new Error(error.message);
}

export async function emailOf(userId: string): Promise<string> {
  const { data, error } = await db().auth.admin.getUserById(userId);
  if (error || !data.user?.email) throw new Error("Account not found.");
  return data.user.email;
}

/** Sign someone in without a password: a one-time link, redeemed right here on the server. */
export async function sessionFor(email: string): Promise<{ access_token: string; refresh_token: string }> {
  const { data, error } = await db().auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) throw new Error(`Couldn't sign you in: ${error?.message ?? "no link"}`);
  const anon = createClient(cloud.url, cloud.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const v = await anon.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "email" });
  if (v.error || !v.data.session) throw new Error(`Couldn't sign you in: ${v.error?.message ?? "no session"}`);
  return { access_token: v.data.session.access_token, refresh_token: v.data.session.refresh_token };
}

/** Check a browser's sign-in token and return who it belongs to. */
export async function userFromToken(token: string): Promise<string | null> {
  const { data, error } = await db().auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}
