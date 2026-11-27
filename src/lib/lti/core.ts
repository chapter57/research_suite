// LTI 1.3 pieces that don't touch the database, kept separate so they can be tested.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

export const LTI = {
  messageType: "https://purl.imsglobal.org/spec/lti/claim/message_type",
  version: "https://purl.imsglobal.org/spec/lti/claim/version",
  deploymentId: "https://purl.imsglobal.org/spec/lti/claim/deployment_id",
  roles: "https://purl.imsglobal.org/spec/lti/claim/roles",
  context: "https://purl.imsglobal.org/spec/lti/claim/context",
};

export function randomToken(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

// ---------- Signed values (state cookie, teacher link token) ----------

export function sign(data: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(data)).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function unsign<T extends { exp: number }>(token: string | undefined, secret: string): T | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString()) as T;
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

// ---------- Launch validation ----------

export interface Registration {
  id: string;
  class_id: string;
  teacher: string;
  issuer: string;
  client_id: string;
  deployment_id: string;
  auth_url: string;
  jwks_url: string;
}

export interface Launch {
  sub: string;
  name: string;
  isInstructor: boolean;
  contextTitle?: string;
}

const keysets = new Map<string, JWTVerifyGetKey>();
function keysetFor(url: string): JWTVerifyGetKey {
  let k = keysets.get(url);
  if (!k) {
    k = createRemoteJWKSet(new URL(url));
    keysets.set(url, k);
  }
  return k;
}

export class LaunchError extends Error {}

/** Check Moodle's signed launch message and pull out who is launching. */
export async function verifyLaunch(idToken: string, reg: Registration, nonce: string, getKey: JWTVerifyGetKey = keysetFor(reg.jwks_url)): Promise<Launch> {
  let payload: JWTPayload & Record<string, unknown>;
  try {
    ({ payload } = (await jwtVerify(idToken, getKey, { issuer: reg.issuer, audience: reg.client_id, algorithms: ["RS256"] })) as {
      payload: JWTPayload & Record<string, unknown>;
    });
  } catch (e) {
    throw new LaunchError(`Moodle's message couldn't be verified (${e instanceof Error ? e.message : "invalid"}).`);
  }
  if (payload.nonce !== nonce) throw new LaunchError("This launch was already used or doesn't match. Please click the link in Moodle again.");
  // The deployment ID is optional when connecting (Moodle doesn't show it to teachers).
  if (reg.deployment_id && payload[LTI.deploymentId] !== reg.deployment_id) throw new LaunchError("This launch came from a different Moodle deployment than the one connected.");
  if (payload[LTI.messageType] !== "LtiResourceLinkRequest") throw new LaunchError("Research Suite only supports regular activity launches from Moodle.");
  if (payload[LTI.version] !== "1.3.0") throw new LaunchError("Research Suite needs LTI version 1.3.");
  if (typeof payload.sub !== "string" || !payload.sub) throw new LaunchError("Moodle didn't say who is launching.");

  const roles = Array.isArray(payload[LTI.roles]) ? (payload[LTI.roles] as string[]) : [];
  const isInstructor = roles.some((r) => /#(Instructor|Administrator|ContentDeveloper|TeachingAssistant)$/.test(r) || /\/(Instructor|Administrator)$/.test(r));
  const given = typeof payload.given_name === "string" ? payload.given_name : "";
  const family = typeof payload.family_name === "string" ? payload.family_name : "";
  const name = (typeof payload.name === "string" && payload.name.trim()) || `${given} ${family}`.trim() || "Moodle student";
  const ctx = payload[LTI.context] as { title?: string } | undefined;
  return { sub: payload.sub, name, isInstructor, contextTitle: ctx?.title };
}

/** Moodle students get an account with a placeholder address that can never receive mail. */
export function placeholderEmail(issuer: string, sub: string): string {
  const h = createHmac("sha256", "research-suite-lti").update(`${issuer}|${sub}`).digest("hex").slice(0, 24);
  return `moodle-${h}@lti.researchsuite.invalid`;
}
