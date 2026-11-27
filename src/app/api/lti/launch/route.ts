// Step 2 of a Moodle launch: Moodle posts a signed message saying who the user
// is. We check it, find or create their account, and sign them in.
import { NextResponse, type NextRequest } from "next/server";
import { LaunchError, sign, unsign, verifyLaunch } from "@/lib/lti/core";
import { origin, page, params } from "@/lib/lti/http";
import { emailOf, enroll, getRegistration, linkedUser, secretKey, sessionFor, signingSecret, studentAccount } from "@/lib/lti/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!secretKey()) return page("Not set up yet", "Moodle connections aren't switched on for this Research Suite site yet.", 503);
  const p = await params(req);
  const state = p.get("state") ?? "";
  const idToken = p.get("id_token");
  const saved = unsign<{ nonce: string; reg: string; exp: number }>(req.cookies.get(`lti_${state}`)?.value, signingSecret());
  if (!saved) {
    return page(
      "Please open Research Suite in a new window",
      "Your browser blocked the sign-in step, which happens when Research Suite opens inside the Moodle page. Ask your instructor to set the activity's launch container to “New window,” or try the link again.",
    );
  }
  if (!idToken) return page("Something's missing", "Moodle didn't send the sign-in message. Please click the activity in Moodle again.");

  const reg = await getRegistration(saved.reg);
  if (!reg) return page("This connection was removed", "Your instructor disconnected this Moodle course from Research Suite.", 404);

  const base = origin(req);
  const done = (res: NextResponse) => {
    res.cookies.set(`lti_${state}`, "", { path: "/api/lti", maxAge: 0, secure: true, sameSite: "none" });
    return res;
  };

  try {
    const launch = await verifyLaunch(idToken, reg, saved.nonce);

    if (launch.isInstructor) {
      const userId = await linkedUser(reg.issuer, launch.sub);
      if (userId === reg.teacher) {
        const s = await sessionFor(await emailOf(userId));
        return done(NextResponse.redirect(`${base}/lti/done#${new URLSearchParams({ ...s, next: `/class/${reg.class_id}` })}`, 303));
      }
      if (userId) {
        return done(page("This class belongs to another teacher", "Your Moodle account is connected to a different Research Suite teacher account than the one that owns this class.", 403));
      }
      // First visit: the teacher confirms once by signing in with their Research Suite account.
      const t = sign({ reg: reg.id, sub: launch.sub, exp: Date.now() + 15 * 60_000 }, signingSecret());
      return done(NextResponse.redirect(`${base}/lti/link#${new URLSearchParams({ t })}`, 303));
    }

    const account = await studentAccount(reg, launch);
    await enroll(reg.class_id, account.id, launch.name);
    const s = await sessionFor(account.email);
    return done(NextResponse.redirect(`${base}/lti/done#${new URLSearchParams({ ...s, next: "/" })}`, 303));
  } catch (e) {
    if (e instanceof LaunchError) return done(page("Moodle sign-in didn't work", e.message, 401));
    console.error("LTI launch failed", e);
    return done(page("Something went wrong", "Research Suite couldn't finish signing you in from Moodle. Please try again in a minute.", 500));
  }
}
