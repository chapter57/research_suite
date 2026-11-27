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

export interface Account {
  id: string;
  email: string;
  name: string;
}

function toAccount(u: User | null | undefined): Account | null {
  if (!u) return null;
  return { id: u.id, email: u.email ?? "", name: (u.user_metadata?.display_name as string) || u.email || "" };
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

export async function signUp(name: string, email: string, password: string): Promise<Account> {
  const { data, error } = await sb().auth.signUp({ email: email.trim(), password, options: { data: { display_name: name.trim() } } });
  if (error) throw new Error(friendly(error.message));
  if (!data.session) throw new Error("Your account was created, but sign-in needs email confirmation. Please tell your instructor.");
  return toAccount(data.user)!;
}

export async function signIn(email: string, password: string): Promise<Account> {
  const { data, error } = await sb().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(friendly(error.message));
  return toAccount(data.user)!;
}

export async function signOutOnly() {
  await sb().auth.signOut();
}
