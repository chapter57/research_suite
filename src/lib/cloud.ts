"use client";
// Sign-in and the connection to cloud storage (Supabase).
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { cloud } from "@/config/cloud";

let client: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  client ??= createClient(cloud.url, cloud.publishableKey, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}

export type Role = "teacher" | "student";

export interface Account {
  id: string;
  email: string;
  name: string;
  /** The role chosen at sign-up (older accounts may not have one). */
  chosenRole?: Role;
}

function toAccount(u: User | null | undefined): Account | null {
  if (!u) return null;
  const r = u.user_metadata?.role;
  return {
    id: u.id,
    email: u.email ?? "",
    name: (u.user_metadata?.display_name as string) || u.email || "",
    chosenRole: r === "teacher" || r === "student" ? r : undefined,
  };
}

export async function currentAccount(): Promise<Account | null> {
  const { data } = await sb().auth.getSession();
  return toAccount(data.session?.user);
}

/** The signed-in account, kept up to date. `undefined` while checking. */
export function useAccount(): Account | null | undefined {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    currentAccount().then((a) => live && setAccount(a));
    const { data } = sb().auth.onAuthStateChange((_e, session) => live && setAccount(toAccount(session?.user)));
    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return account;
}

function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return "That email and password don't match an account.";
  if (/already registered|already exists/i.test(message)) return "There's already an account with that email. Try signing in.";
  if (/password should be at least/i.test(message)) return "Your password needs at least 6 characters.";
  if (/rate limit/i.test(message)) return "Too many attempts. Wait a minute and try again.";
  if (/fetch|network/i.test(message)) return "Couldn't reach the server. Check your internet connection.";
  return message;
}

export async function signUp(name: string, email: string, password: string, role: Role): Promise<Account> {
  const { data, error } = await sb().auth.signUp({ email: email.trim(), password, options: { data: { display_name: name.trim(), role } } });
  if (error) throw new Error(friendly(error.message));
  if (!data.session) throw new Error("Your account was created, but sign-in needs email confirmation. Please tell your instructor.");
  const account = toAccount(data.user)!;
  if (role === "teacher") await becomeTeacher(account);
  return account;
}

/** Register this account as a teacher (allowed to create classes). */
export async function becomeTeacher(account: Account) {
  const res = await sb().from("instructors").insert({ user_id: account.id });
  // 23505 = already registered, which is fine.
  if (res.error && res.error.code !== "23505") throw new Error("Your account was created, but teacher setup didn't finish: " + res.error.message);
}

/** Teacher or student. Teachers are accounts on the instructor list. */
export async function roleOf(account: Account): Promise<Role> {
  const res = await sb().from("instructors").select("user_id").eq("user_id", account.id);
  if (!res.error && res.data.length) return "teacher";
  if (account.chosenRole === "teacher") {
    // Chose teacher at sign-up but registration didn't finish: try again.
    try {
      await becomeTeacher(account);
      return "teacher";
    } catch {
      /* fall through */
    }
  }
  return "student";
}

/** The signed-in account and its role, kept up to date. `undefined` while checking. */
export function useSession(): { account: Account | null | undefined; role: Role | undefined } {
  const account = useAccount();
  const [role, setRole] = useState<Role | undefined>(undefined);
  useEffect(() => {
    if (!account) return setRole(undefined);
    let live = true;
    roleOf(account).then((r) => live && setRole(r)).catch(() => live && setRole(account.chosenRole ?? "student"));
    return () => {
      live = false;
    };
  }, [account]);
  return { account, role };
}

export async function signIn(email: string, password: string): Promise<Account> {
  const { data, error } = await sb().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(friendly(error.message));
  return toAccount(data.user)!;
}

export async function signOutOnly() {
  await sb().auth.signOut();
}
