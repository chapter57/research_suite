"use client";
// Last step of arriving from Moodle: keep the sign-in and go to the right page.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { sb } from "@/lib/cloud";

export default function LtiDone() {
  const router = useRouter();
  const [error, setError] = useState("");
  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1));
    const access_token = h.get("access_token");
    const refresh_token = h.get("refresh_token");
    const next = h.get("next") || "/";
    history.replaceState(null, "", window.location.pathname); // don't leave tokens in the address bar
    if (!access_token || !refresh_token) return setError("The sign-in from Moodle didn't come through. Please click the activity in Moodle again.");
    sb()
      .auth.setSession({ access_token, refresh_token })
      .then(({ error: e }) => (e ? setError(e.message) : router.replace(next.startsWith("/") ? next : "/")));
  }, [router]);
  return <main className="home">{error ? <p className="error">{error}</p> : <p className="muted">Signing you in from Moodle…</p>}</main>;
}
