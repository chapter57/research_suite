// Server route for the AI coach. The API key lives only on the server.
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { course } from "@/config/course";
import { modeById, type ModeId } from "@/lib/coach/modes";
import { KitAccessError, resolveKit } from "@/lib/coach/kitServer";
import { buildSystemPrompt } from "@/lib/coach/prompt";

export const runtime = "nodejs";

const MODEL = process.env.COACH_MODEL || "claude-haiku-5-5";
const DAILY_LIMIT = Number(process.env.COACH_DAILY_LIMIT || 60);
// Models that support server-side refusal fallbacks.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-fable-5-1"]);

// Simple per-browser daily limit. Resets when the server restarts; replaced by
// per-account limits once accounts exist.
const usage = new Map<string, { day: string; n: number }>();
function overLimit(clientId: string): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const u = usage.get(clientId);
  if (!u || u.day !== day) {
    usage.set(clientId, { day, n: 1 });
    return false;
  }
  u.n++;
  return u.n > DAILY_LIMIT;
}

interface CoachRequest {
  mode: ModeId;
  /** Name of the course objective the student chose to focus on. */
  focus?: string;
  /** The class the project is for (its locked kit is used). */
  classId?: string;
  /** A teacher's own kit, for a teacher's own project. */
  kitId?: string;
  /** A kit being edited, for "Test the coach" (teachers only). */
  kit?: unknown;
  question: string;
  excerpt?: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

let client: Anthropic | null = null;

export async function POST(req: Request) {
  if (!course.aiAvailable) return NextResponse.json({ error: "The coach is turned off for this course." }, { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "The AI coach isn't set up yet. The instructor needs to add an API key on the server." },
      { status: 503 },
    );
  }

  let body: CoachRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const mode = modeById[body.mode];
  if (!mode || !course.allowedModes.includes(mode.id)) {
    return NextResponse.json({ error: "That coach mode isn't available." }, { status: 400 });
  }
  const question = String(body.question || "").slice(0, 2000).trim();
  const excerpt = String(body.excerpt || "").slice(0, course.maxExcerptChars).trim();
  if (!question && !excerpt) return NextResponse.json({ error: "Ask a question or include part of your draft." }, { status: 400 });

  const clientId = req.headers.get("x-client-id") || "anon";
  if (overLimit(clientId)) {
    return NextResponse.json({ error: `You've reached today's limit of ${DAILY_LIMIT} coach requests. Try again tomorrow.` }, { status: 429 });
  }

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  let kit;
  try {
    kit = await resolveKit({ token, classId: body.classId, kitId: body.kitId, kit: body.kit });
  } catch (e) {
    if (e instanceof KitAccessError) return NextResponse.json({ error: e.message }, { status: 403 });
    console.error("Kit lookup failed", e);
    return NextResponse.json({ error: "Couldn't load the course kit. Try again shortly." }, { status: 502 });
  }
  const focus = kit.objectives.find((o) => o.name === body.focus);
  const system = buildSystemPrompt(kit, mode, focus);

  const history: Anthropic.Beta.BetaMessageParam[] = (body.history || [])
    .slice(-6)
    .filter((h) => (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
    .map((h) => ({ role: h.role, content: h.content.slice(0, 4000) }));
  // The API needs the conversation to start with a user turn.
  while (history.length && history[0].role !== "user") history.shift();

  let userText = "";
  if (excerpt) userText += `<draft_excerpt>\n${excerpt}\n</draft_excerpt>\n\n`;
  userText += question ? `Student's question: ${question}` : "The student asked for coaching on this excerpt.";

  client ??= new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [...history, { role: "user", content: userText }],
      ...(FALLBACK_MODELS.has(MODEL) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json({ answer: "I can't help with that one. Try asking about your draft, your sources, or a course skill." });
    }
    const answer = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return NextResponse.json({ answer: answer || "Sorry, I didn't come up with anything useful. Try rephrasing?" });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "The coach's API key isn't valid. Please tell your instructor." }, { status: 503 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "The coach is busy right now. Try again in a minute." }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      console.error("Coach API error", error.status, error.message);
      return NextResponse.json({ error: "The coach couldn't respond. Try again shortly." }, { status: 502 });
    }
    console.error("Coach error", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
