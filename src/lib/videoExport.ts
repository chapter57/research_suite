"use client";
// Renders a project's writing-process replay, with its reflections, into a
// video file. Frames are drawn on a canvas and recorded in real time with
// MediaRecorder; voice reflections are mixed into the soundtrack.
import type { Node as PMNode } from "@tiptap/pm/model";
import { buildTimeline, computeStats, formatDuration, ReplayEngine, type ChangeRange } from "./replay";
import { getDocSchema } from "./schema";
import { getEvents, getProject, getReflections } from "./store";
import type { Reflection } from "./types";

export const VIDEO_W = 1280;
export const VIDEO_H = 720;

const PAGE_X = 220;
const PAGE_W = VIDEO_W - PAGE_X * 2;
const PAD = 48;
const TOP = 72;
const BOTTOM = VIDEO_H - 64;
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const C = {
  bg: "#efece5",
  page: "#ffffff",
  ink: "#1f2328",
  muted: "#5f6670",
  accent: "#1f5f8b",
  fresh: "#fff1a8",
  coach: "#6b4fa0",
  paste: "#b5651d",
  note: "#1f7a5a",
  line: "#d9d3c7",
};

export function pickVideoFormat(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const options = [
    // H.264 MP4 plays everywhere (Chrome, Safari, Edge, QuickTime, Moodle).
    { mime: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", ext: "mp4" },
    { mime: "video/mp4;codecs=avc1.42E01E", ext: "mp4" },
    // Otherwise WebM, which browsers and Moodle's player handle.
    { mime: "video/webm;codecs=vp9,opus", ext: "webm" },
    { mime: "video/webm;codecs=vp8,opus", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
    { mime: "video/mp4", ext: "mp4" },
  ];
  return options.find((o) => MediaRecorder.isTypeSupported(o.mime)) ?? null;
}

// ---------- Text layout (cached per unchanged block) ----------

interface Line {
  text: string;
  start: number; // char offset within the block
}
interface BlockLayout {
  lines: Line[];
  font: string;
  lineH: number;
  indent: number;
  gapAfter: number;
}

const layoutCache = new WeakMap<PMNode, BlockLayout>();

function blockText(node: PMNode): string {
  let s = "";
  node.forEach((child) => {
    if (child.isText) s += child.text;
    else s += child.type.name === "hardBreak" ? "\n" : " ".repeat(child.nodeSize);
  });
  return s;
}

function layoutBlock(ctx: CanvasRenderingContext2D, node: PMNode, depth: number, width: number): BlockLayout {
  const cached = layoutCache.get(node);
  if (cached) return cached;
  const isHeading = node.type.name === "heading";
  const level = Number(node.attrs.level ?? 2);
  const size = isHeading ? (level === 1 ? 30 : 24) : 19;
  const font = `${isHeading ? "bold " : ""}${size}px ${SERIF}`;
  const indent = depth * 28;
  const text = blockText(node);
  ctx.font = font;
  const lines: Line[] = [];
  const maxW = width - indent;
  for (const [segStart, seg] of splitKeep(text, "\n")) {
    const tokens = seg.match(/\S+\s*|\s+/g) ?? [""];
    let line = "";
    let lineStart = segStart;
    let offset = segStart;
    for (const tok of tokens) {
      if (line && ctx.measureText(line + tok.trimEnd()).width > maxW) {
        lines.push({ text: line, start: lineStart });
        line = "";
        lineStart = offset;
      }
      line += tok;
      offset += tok.length;
    }
    lines.push({ text: line, start: lineStart });
  }
  const l: BlockLayout = { lines, font, lineH: Math.round(size * 1.6), indent, gapAfter: isHeading ? 8 : 12 };
  layoutCache.set(node, l);
  return l;
}

function splitKeep(s: string, sep: string): [number, string][] {
  const out: [number, string][] = [];
  let i = 0;
  for (const part of s.split(sep)) {
    out.push([i, part]);
    i += part.length + sep.length;
  }
  return out;
}

interface Placed {
  layout: BlockLayout;
  y: number;
  contentStart: number;
}

function placeDoc(ctx: CanvasRenderingContext2D, doc: PMNode): { placed: Placed[]; height: number } {
  const placed: Placed[] = [];
  let y = 0;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let depth = 0;
    const $pos = doc.resolve(pos);
    for (let d = $pos.depth; d > 0; d--) if (["blockquote", "bulletList", "orderedList"].includes($pos.node(d).type.name)) depth++;
    const layout = layoutBlock(ctx, node, depth, PAGE_W - PAD * 2);
    placed.push({ layout, y, contentStart: pos + 1 });
    y += layout.lines.length * layout.lineH + layout.gapAfter;
    return false;
  });
  return { placed, height: y };
}

// ---------- Drawing ----------

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/)) {
      const t = line ? `${line} ${w}` : w;
      if (line && ctx.measureText(t).width > maxW) {
        out.push(line);
        line = w;
      } else line = t;
    }
    out.push(line);
  }
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export interface VideoProgress {
  fraction: number;
  label: string;
}

export async function exportReplayVideo(
  projectId: string,
  canvas: HTMLCanvasElement,
  opts: { targetSeconds?: number; onProgress?: (p: VideoProgress) => void; signal?: AbortSignal } = {},
): Promise<{ blob: Blob; ext: string }> {
  const format = pickVideoFormat();
  if (!format) throw new Error("This browser can't record video. Try Chrome, Edge, Firefox or Safari.");
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found.");
  const [events, refs] = await Promise.all([getEvents(projectId), getReflections(projectId)]);
  if (!events.length) throw new Error("Nothing has been recorded yet.");

  const engine = new ReplayEngine(getDocSchema(), events);
  const timeline = buildTimeline(events);
  const stats = computeStats(events);
  const target = (opts.targetSeconds ?? 150) * 1000;
  const speed = Math.max(1, timeline.total / target);
  const sessionOf: number[] = [];
  let sn = 0;
  for (const e of events) sessionOf.push(e.type === "session" ? ++sn : sn);

  canvas.width = VIDEO_W;
  canvas.height = VIDEO_H;
  const ctx = canvas.getContext("2d")!;

  // ---- Audio ----
  const audio = new AudioContext();
  await audio.resume().catch(() => {});
  const dest = audio.createMediaStreamDestination();
  // A silent source keeps the audio track alive so players accept the file.
  const silence = audio.createConstantSource();
  silence.offset.value = 0;
  silence.connect(dest);
  silence.start();
  const buffers = new Map<string, AudioBuffer>();
  for (const r of refs) {
    if (!r.audio) continue;
    try {
      buffers.set(r.id, await audio.decodeAudioData(await r.audio.arrayBuffer()));
    } catch {
      /* skip unreadable audio */
    }
  }

  const anchor = (r: Reflection) => (r.at <= 0 ? 0 : timeline.times[r.at - 1]);
  const noteMs = (r: Reflection) => {
    const b = buffers.get(r.id);
    if (b) return b.duration * 1000 + 900;
    return Math.min(12000, Math.max(4000, 2500 + (r.text?.length ?? 0) * 45));
  };
  const INTRO = 3000;
  const OUTRO = 4000;
  const estTotal = INTRO + timeline.total / speed + refs.reduce((s, r) => s + noteMs(r), 0) + OUTRO;

  const markers = events.flatMap((e, i) => {
    if (e.type === "ai") return [{ t: timeline.times[i], c: C.coach }];
    if (e.type === "steps" && (e.ui === "paste" || e.ui === "drop") && (e.inserted ?? 0) > 20) return [{ t: timeline.times[i], c: C.paste }];
    return [];
  });

  // ---- Recorder ----
  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const recorder = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((res) => (recorder.onstop = () => res()));

  let scrollY = 0;

  function drawFrame(pos: number, note: Reflection | null) {
    const count = countAt(pos);
    const { doc, range } = engine.frameAt(count);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);

    // Page
    ctx.fillStyle = C.page;
    ctx.fillRect(PAGE_X, TOP - 8, PAGE_W, BOTTOM - TOP + 8);
    const { placed, height } = placeDoc(ctx, doc);
    const viewH = BOTTOM - TOP - PAD;
    const target = focusY(placed, range);
    if (target !== null) {
      let desired = scrollY;
      if (target < scrollY + 40 || target > scrollY + viewH - 80) desired = target - viewH / 2;
      desired = Math.max(0, Math.min(desired, Math.max(0, height - viewH + 40)));
      scrollY += (desired - scrollY) * 0.25;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAGE_X, TOP - 8, PAGE_W, BOTTOM - TOP + 8);
    ctx.clip();
    const x0 = PAGE_X + PAD;
    const y0 = TOP + PAD / 2 - scrollY;
    for (const p of placed) {
      const L = p.layout;
      ctx.font = L.font;
      L.lines.forEach((line, li) => {
        const y = y0 + p.y + li * L.lineH;
        if (y < TOP - L.lineH || y > BOTTOM + L.lineH) return;
        const x = x0 + L.indent;
        if (range) highlight(line, p.contentStart, x, y, L.lineH, range);
        ctx.fillStyle = C.ink;
        ctx.textBaseline = "top";
        ctx.fillText(line.text, x, y + (L.lineH - parseInt(L.font.replace(/\D+/, ""), 10)) / 2);
      });
    }
    ctx.restore();

    // Top bar
    ctx.fillStyle = C.ink;
    ctx.font = `600 20px ${SANS}`;
    ctx.textBaseline = "middle";
    ctx.fillText(project!.title, 24, 34);
    if (count > 0) {
      const e = events[count - 1];
      ctx.font = `15px ${SANS}`;
      ctx.fillStyle = C.muted;
      const s = `Session ${sessionOf[count - 1]} · ${new Date(e.t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
      ctx.fillText(s, VIDEO_W - 24 - ctx.measureText(s).width, 34);
    }

    // Progress bar
    const barX = 24;
    const barW = VIDEO_W - 48;
    const barY = VIDEO_H - 30;
    ctx.fillStyle = C.line;
    roundRect(ctx, barX, barY, barW, 6, 3);
    ctx.fill();
    ctx.fillStyle = C.accent;
    roundRect(ctx, barX, barY, Math.max(6, (barW * pos) / (timeline.total || 1)), 6, 3);
    ctx.fill();
    for (const m of markers) {
      ctx.fillStyle = m.c;
      ctx.fillRect(barX + (barW * m.t) / (timeline.total || 1) - 1, barY - 6, 3, 6);
    }
    for (const r of refs) {
      ctx.fillStyle = C.note;
      ctx.fillRect(barX + (barW * anchor(r)) / (timeline.total || 1) - 1, barY - 8, 3, 8);
    }
    ctx.font = `13px ${SANS}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(`Writing process replay · ${Math.round(speed)}× speed`, barX, barY - 16);

    if (note) drawNote(note);
  }

  function countAt(pos: number) {
    let lo = 0;
    let hi = timeline.times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (timeline.times[mid] <= pos) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function focusY(placed: Placed[], range: ChangeRange | null): number | null {
    if (!range) return null;
    for (const p of placed) {
      const end = p.contentStart + p.layout.lines.reduce((n, l) => n + l.text.length, 0) + p.layout.lines.length;
      if (range.from >= p.contentStart - 1 && range.from <= end) {
        const off = range.from - p.contentStart;
        let li = p.layout.lines.findIndex((l, i) => off < l.start + l.text.length || i === p.layout.lines.length - 1);
        if (li < 0) li = 0;
        return p.y + li * p.layout.lineH;
      }
    }
    return null;
  }

  function highlight(line: Line, contentStart: number, x: number, y: number, h: number, range: ChangeRange) {
    const a = range.from - contentStart - line.start;
    const b = range.to - contentStart - line.start;
    if (b < 0 || a > line.text.length) return;
    if (a === b) {
      if (a >= 0 && a <= line.text.length) {
        ctx.fillStyle = C.accent;
        ctx.fillRect(x + ctx.measureText(line.text.slice(0, a)).width, y + 4, 2, h - 8);
      }
      return;
    }
    const s = Math.max(0, a);
    const e = Math.min(line.text.length, b);
    if (e <= s) return;
    const sx = ctx.measureText(line.text.slice(0, s)).width;
    const w = ctx.measureText(line.text.slice(s, e)).width;
    ctx.fillStyle = C.fresh;
    ctx.fillRect(x + sx, y + 2, w, h - 4);
  }

  function drawNote(r: Reflection) {
    const boxW = 760;
    ctx.font = `20px ${SANS}`;
    const voice = buffers.has(r.id);
    const lines = r.text ? wrap(ctx, r.text, boxW - 48).slice(0, 6) : voice ? ["Listen to the writer's voice note."] : [];
    const boxH = 70 + lines.length * 28 + (voice && !lines.length ? 10 : 0);
    const x = (VIDEO_W - boxW) / 2;
    const y = BOTTOM - boxH - 24;
    ctx.fillStyle = "rgba(20, 40, 34, 0.92)";
    roundRect(ctx, x, y, boxW, boxH, 14);
    ctx.fill();
    ctx.fillStyle = "#8be0bd";
    ctx.font = `600 15px ${SANS}`;
    ctx.textBaseline = "top";
    ctx.fillText(voice ? "REFLECTION · voice note playing" : "REFLECTION", x + 24, y + 20);
    ctx.fillStyle = "#ffffff";
    ctx.font = `20px ${SANS}`;
    lines.forEach((l, i) => ctx.fillText(l, x + 24, y + 48 + i * 28));
  }

  function drawCard(title: string, lines: string[]) {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);
    ctx.textBaseline = "top";
    ctx.fillStyle = C.muted;
    ctx.font = `600 16px ${SANS}`;
    const kicker = "RESEARCH SUITE · WRITING PROCESS";
    ctx.fillText(kicker, (VIDEO_W - ctx.measureText(kicker).width) / 2, 200);
    ctx.fillStyle = C.ink;
    ctx.font = `bold 40px ${SERIF}`;
    const tl = wrap(ctx, title, 1000).slice(0, 2);
    tl.forEach((l, i) => ctx.fillText(l, (VIDEO_W - ctx.measureText(l).width) / 2, 240 + i * 52));
    ctx.font = `20px ${SANS}`;
    ctx.fillStyle = C.muted;
    lines.forEach((l, i) => ctx.fillText(l, (VIDEO_W - ctx.measureText(l).width) / 2, 260 + tl.length * 52 + i * 32));
  }

  const statLine = `${stats.sessions} session${stats.sessions === 1 ? "" : "s"} · ${formatDuration(stats.activeMs)} of active writing · ${refs.length} reflection${refs.length === 1 ? "" : "s"}`;
  const introLines = [project.author ? `by ${project.author}` : "", statLine].filter(Boolean);
  const outroLines = [
    statLine,
    `${stats.typedChars.toLocaleString()} characters typed · ${stats.pastedChars.toLocaleString()} pasted · ${stats.aiExchanges} coach exchange${stats.aiExchanges === 1 ? "" : "s"}`,
  ];

  // ---- Run the show ----
  const sortedRefs = [...refs].sort((a, b) => anchor(a) - anchor(b) || a.createdAt - b.createdAt);
  type Phase = { kind: "intro" | "play" | "note" | "outro"; until?: number; note?: Reflection };
  let phase: Phase = { kind: "intro", until: INTRO };
  let pos = 0;
  let phaseElapsed = 0;
  let elapsed = 0;
  const queue: Reflection[] = sortedRefs.filter((r) => anchor(r) <= 0);
  let nextRef = queue.length;

  drawCard(project.title, introLines);
  recorder.start(1000);

  await new Promise<void>((resolve, reject) => {
    let last = performance.now();
    const onAbort = () => reject(new DOMException("Cancelled", "AbortError"));
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const tick = (now: number) => {
      if (opts.signal?.aborted) return;
      const dt = Math.min(100, now - last);
      last = now;
      elapsed += dt;
      phaseElapsed += dt;

      const startNote = (r: Reflection) => {
        phase = { kind: "note", until: noteMs(r), note: r };
        phaseElapsed = 0;
        const b = buffers.get(r.id);
        if (b) {
          const src = audio.createBufferSource();
          src.buffer = b;
          src.connect(dest);
          src.start(audio.currentTime + 0.3);
        }
      };

      if (phase.kind === "intro") {
        drawCard(project!.title, introLines);
        if (phaseElapsed >= INTRO) {
          phaseElapsed = 0;
          if (queue.length) startNote(queue.shift()!);
          else phase = { kind: "play" };
        }
      } else if (phase.kind === "play") {
        const np = Math.min(timeline.total, pos + dt * speed);
        while (nextRef < sortedRefs.length && anchor(sortedRefs[nextRef]) <= np) queue.push(sortedRefs[nextRef++]);
        if (queue.length) {
          pos = Math.max(pos, anchor(queue[0]));
          startNote(queue.shift()!);
          drawFrame(pos, phase.note ?? null);
        } else {
          pos = np;
          drawFrame(pos, null);
          if (pos >= timeline.total) {
            phase = { kind: "outro", until: OUTRO };
            phaseElapsed = 0;
          }
        }
      } else if (phase.kind === "note") {
        drawFrame(pos, phase.note!);
        if (phaseElapsed >= phase.until!) {
          phaseElapsed = 0;
          if (queue.length) startNote(queue.shift()!);
          else phase = pos >= timeline.total ? { kind: "outro", until: OUTRO } : { kind: "play" };
        }
      } else {
        drawCard("That's the process.", outroLines);
        if (phaseElapsed >= OUTRO) {
          opts.signal?.removeEventListener("abort", onAbort);
          resolve();
          return;
        }
      }
      opts.onProgress?.({ fraction: Math.min(0.99, elapsed / estTotal), label: phase.kind === "note" ? "Adding a reflection…" : "Recording replay…" });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }).catch(async (e) => {
    recorder.stop();
    await stopped;
    silence.stop();
    await audio.close();
    throw e;
  });

  recorder.stop();
  await stopped;
  silence.stop();
  await audio.close();
  opts.onProgress?.({ fraction: 1, label: "Done" });
  return { blob: new Blob(chunks, { type: format.mime.split(";")[0] }), ext: format.ext };
}

export function estimateVideoSeconds(totalPlaybackMs: number, reflections: number, targetSeconds = 150) {
  const speed = Math.max(1, totalPlaybackMs / (targetSeconds * 1000));
  return Math.round(totalPlaybackMs / speed / 1000 + reflections * 7 + 7);
}
