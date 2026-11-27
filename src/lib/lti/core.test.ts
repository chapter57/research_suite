import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { LaunchError, LTI, placeholderEmail, sign, unsign, verifyLaunch, type Registration } from "./core.ts";

const reg: Registration = {
  id: "r1", class_id: "c1", teacher: "t1",
  issuer: "https://moodle.example.edu", client_id: "abc123", deployment_id: "7",
  auth_url: "https://moodle.example.edu/mod/lti/auth.php", jwks_url: "https://moodle.example.edu/mod/lti/certs.php",
};

async function platform() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const keyset = createLocalJWKSet({ keys: [jwk] });
  const token = (claims: Record<string, unknown>, opts: { iss?: string; aud?: string; exp?: string } = {}) =>
    new SignJWT({
      nonce: "n1",
      [LTI.deploymentId]: "7",
      [LTI.messageType]: "LtiResourceLinkRequest",
      [LTI.version]: "1.3.0",
      [LTI.roles]: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
      name: "Ada Lovelace",
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(opts.iss ?? reg.issuer)
      .setAudience(opts.aud ?? reg.client_id)
      .setSubject("moodle-user-42")
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "5m")
      .sign(privateKey);
  return { keyset, token };
}

test("a genuine student launch is accepted", async () => {
  const { keyset, token } = await platform();
  const l = await verifyLaunch(await token({}), reg, "n1", keyset);
  assert.deepEqual(l, { sub: "moodle-user-42", name: "Ada Lovelace", isInstructor: false, contextTitle: undefined });
});

test("with no deployment ID saved, any deployment of that tool is accepted", async () => {
  const { keyset, token } = await platform();
  const l = await verifyLaunch(await token({ [LTI.deploymentId]: "99" }), { ...reg, deployment_id: "" }, "n1", keyset);
  assert.equal(l.sub, "moodle-user-42");
});

test("instructors are recognized", async () => {
  const { keyset, token } = await platform();
  const l = await verifyLaunch(await token({ [LTI.roles]: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"] }), reg, "n1", keyset);
  assert.equal(l.isInstructor, true);
});

test("forged, replayed and mismatched launches are rejected", async () => {
  const { keyset, token } = await platform();
  const other = await platform(); // a different key: a forgery
  const cases: [string, Promise<string>, string?][] = [
    ["forged signature", other.token({})],
    ["wrong nonce (replay)", token({ nonce: "old" })],
    ["wrong deployment", token({ [LTI.deploymentId]: "8" })],
    ["wrong audience", token({}, { aud: "someone-else" })],
    ["wrong issuer", token({}, { iss: "https://evil.example" })],
    ["expired", token({}, { exp: "-1m" })],
    ["not a resource link", token({ [LTI.messageType]: "LtiDeepLinkingRequest" })],
  ];
  for (const [label, t] of cases) {
    await assert.rejects(verifyLaunch(await t, reg, "n1", keyset), LaunchError, label);
  }
});

test("signed state values can't be altered and expire", () => {
  const s = sign({ nonce: "n", exp: Date.now() + 1000 }, "secret");
  assert.equal(unsign<{ nonce: string; exp: number }>(s, "secret")?.nonce, "n");
  assert.equal(unsign(s, "other-secret"), null);
  const [body] = s.split(".");
  const tampered = Buffer.from(JSON.stringify({ nonce: "x", exp: Date.now() + 1000 })).toString("base64url") + "." + s.split(".")[1];
  assert.notEqual(body, tampered.split(".")[0]);
  assert.equal(unsign(tampered, "secret"), null);
  assert.equal(unsign(sign({ exp: Date.now() - 1 }, "secret"), "secret"), null);
});

test("placeholder emails are stable, private and undeliverable", () => {
  const a = placeholderEmail("https://m.edu", "42");
  assert.equal(a, placeholderEmail("https://m.edu", "42"));
  assert.notEqual(a, placeholderEmail("https://other.edu", "42"));
  assert.match(a, /^moodle-[0-9a-f]{24}@lti\.researchsuite\.invalid$/);
});
