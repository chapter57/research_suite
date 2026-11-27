// Step 1 of a Moodle launch (OIDC login initiation): Moodle sends the browser
// here; we remember a one-time state and nonce, then send it back to Moodle.
import { NextResponse, type NextRequest } from "next/server";
import { randomToken, sign } from "@/lib/lti/core";
import { origin, page, params } from "@/lib/lti/http";
import { findRegistrations, secretKey, signingSecret } from "@/lib/lti/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  if (!secretKey()) return page("Not set up yet", "Moodle connections aren't switched on for this Research Suite site yet.", 503);
  const p = await params(req);
  const iss = p.get("iss");
  const loginHint = p.get("login_hint");
  if (!iss || !loginHint) return page("Something's missing", "This link must be opened from the Research Suite activity in Moodle.");
  const regs = await findRegistrations(iss, p.get("client_id") ?? undefined);
  const dep = p.get("lti_deployment_id");
  const reg = regs.find((r) => !dep || r.deployment_id === dep) ?? (regs.length === 1 ? regs[0] : undefined);
  if (!reg) {
    return page(
      "This Moodle course isn't connected yet",
      "Your instructor needs to finish connecting this Moodle course to a Research Suite class (Connect to Moodle on the class page).",
      404,
    );
  }
  const state = randomToken();
  const nonce = randomToken();
  const target = new URL(reg.auth_url);
  const q: Record<string, string> = {
    scope: "openid",
    response_type: "id_token",
    response_mode: "form_post",
    prompt: "none",
    client_id: reg.client_id,
    redirect_uri: `${origin(req)}/api/lti/launch`,
    login_hint: loginHint,
    state,
    nonce,
  };
  const mh = p.get("lti_message_hint");
  if (mh) q.lti_message_hint = mh;
  Object.entries(q).forEach(([k, v]) => target.searchParams.set(k, v));
  const res = NextResponse.redirect(target, 302);
  res.cookies.set(`lti_${state}`, sign({ nonce, reg: reg.id, exp: Date.now() + 10 * 60_000 }, signingSecret()), {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/api/lti",
    maxAge: 600,
  });
  return res;
}

export const GET = handle;
export const POST = handle;
