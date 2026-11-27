// A teacher's first launch from Moodle: after they sign in with their Research
// Suite account, connect their Moodle identity to it (only the class's owner).
import { NextResponse, type NextRequest } from "next/server";
import { unsign } from "@/lib/lti/core";
import { getRegistration, linkUser, secretKey, signingSecret, userFromToken } from "@/lib/lti/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!secretKey()) return NextResponse.json({ error: "Moodle connections aren't switched on yet." }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { t?: string };
  const data = unsign<{ reg: string; sub: string; exp: number }>(body.t, signingSecret());
  if (!data) return NextResponse.json({ error: "This link has expired. Click the activity in Moodle again." }, { status: 400 });
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const userId = token ? await userFromToken(token) : null;
  if (!userId) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  const reg = await getRegistration(data.reg);
  if (!reg) return NextResponse.json({ error: "This Moodle connection was removed." }, { status: 404 });
  if (reg.teacher !== userId) {
    return NextResponse.json({ error: "Only the teacher who connected this class can link their Moodle account to it. Sign in with that account." }, { status: 403 });
  }
  await linkUser(reg.issuer, data.sub, userId);
  return NextResponse.json({ next: `/class/${reg.class_id}` });
}
