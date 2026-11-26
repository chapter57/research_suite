"use client";
// Renders a project's writing-process replay, with its reflections, into a
// video file. Preferred path: frames are drawn on a canvas and encoded with
// WebCodecs into an MP4 (H.264 video + AAC audio) that plays everywhere,
// including QuickTime. Fallback: record the canvas in real time with
// MediaRecorder. Voice reflections are mixed into the soundtrack either way.
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

const FPS = 30;
const INTRO = 3000;
const OUTRO = 4000;
const NOTE_AUDIO_DELAY = 300;

type Seg =
  | { kind: "intro" | "outro"; start: number; dur: number }
  | { kind: "play"; start: number; dur: number; from: number; to: number }
  | { kind: "note"; start: number; dur: number; pos: number; note: Reflection };

export async function exportReplayVideo(
  projectId: string,
  canvas: HTMLCanvasElement,
  opts: { targetSeconds?: number; onProgress?: (p: VideoProgress) => void; signal?: AbortSignal } = {},
): Promise<{ blob: Blob; ext: string }> {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found.");
  const [events, refs] = await Promise.all([getEvents(projectId), getReflections(projectId)]);
  if (!events.length) throw new Error("Nothing has been recorded yet.");

  const engine = new ReplayEngine(getDocSchema(), events);
  const timeline = buildTimeline(events);
  const stats = computeStats(events);
  const speed = Math.max(1, timeline.total / ((opts.targetSeconds ?? 150) * 1000));
  const sessionOf: number[] = [];
  let sn = 0;
  for (const e of events) sessionOf.push(e.type === "session" ? ++sn : sn);

  canvas.width = VIDEO_W;
  canvas.height = VIDEO_H;
  const ctx = canvas.getContext("2d")!;

  // ---- Voice notes ----
  const decoder = new OfflineAudioContext(1, 1, 48000);
  const buffers = new Map<string, AudioBuffer>();
  for (const r of refs) {
    if (!r.audio) continue;
    try {
      buffers.set(r.id, await decoder.decodeAudioData(await r.audio.arrayBuffer()));
    } catch {
      /* skip unreadable audio */
    }
  }

  // ---- Script: what is on screen at each moment ----
  const anchor = (r: Reflection) => (r.at <= 0 ? 0 : timeline.times[r.at - 1]);
  const noteMs = (r: Reflection) => {
    const b = buffers.get(r.id);
    if (b) return b.duration * 1000 + NOTE_AUDIO_DELAY + 900;
    return Math.min(12000, Math.max(4000, 2500 + (r.text?.length ?? 0) * 45));
  };
  const segs: Seg[] = [];
  let t = 0;
  segs.push({ kind: "intro", start: 0, dur: INTRO });
  t = INTRO;
  let cur = 0;
  for (const r of [...refs].sort((a, b) => anchor(a) - anchor(b) || a.createdAt - b.createdAt)) {
    const a = anchor(r);
    if (a > cur) {
      const dur = (a - cur) / speed;
      segs.push({ kind: "play", start: t, dur, from: cur, to: a });
      t += dur;
      cur = a;
    }
    const dur = noteMs(r);
    segs.push({ kind: "note", start: t, dur, pos: cur, note: r });
    t += dur;
  }
  if (timeline.total > cur) {
    const dur = (timeline.total - cur) / speed;
    segs.push({ kind: "play", start: t, dur, from: cur, to: timeline.total });
    t += dur;
    cur = timeline.total;
  }
  segs.push({ kind: "outro", start: t, dur: OUTRO });
  const totalMs = t + OUTRO;

  let segIdx = 0;
  const segAt = (ms: number): Seg => {
    if (segIdx >= segs.length || segs[segIdx].start > ms) segIdx = 0;
    while (segIdx < segs.length - 1 && segs[segIdx].start + segs[segIdx].dur <= ms) segIdx++;
    return segs[segIdx];
  };

  const markers = events.flatMap((e, i) => {
    if (e.type === "ai") return [{ t: timeline.times[i], c: C.coach }];
    if (e.type === "steps" && (e.ui === "paste" || e.ui === "drop") && (e.inserted ?? 0) > 20) return [{ t: timeline.times[i], c: C.paste }];
    return [];
  });

  const statLine = `${stats.sessions} session${stats.sessions === 1 ? "" : "s"} · ${formatDuration(stats.activeMs)} of active writing · ${refs.length} reflection${refs.length === 1 ? "" : "s"}`;
  const introLines = [project.author ? `by ${project.author}` : "", statLine].filter(Boolean);
  const outroLines = [
    statLine,
    `${stats.typedChars.toLocaleString()} characters typed · ${stats.pastedChars.toLocaleString()} pasted · ${stats.aiExchanges} coach exchange${stats.aiExchanges === 1 ? "" : "s"}`,
  ];

  // ---- Drawing ----
  let scrollY = 0;

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
    const st = Math.max(0, a);
    const en = Math.min(line.text.length, b);
    if (en <= st) return;
    const sx = ctx.measureText(line.text.slice(0, st)).width;
    const w = ctx.measureText(line.text.slice(st, en)).width;
    ctx.fillStyle = C.fresh;
    ctx.fillRect(x + sx, y + 2, w, h - 4);
  }

  function drawNote(r: Reflection) {
    const boxW = 760;
    ctx.font = `20px ${SANS}`;
    const voice = buffers.has(r.id);
    const lines = r.text ? wrap(ctx, r.text, boxW - 48).slice(0, 6) : voice ? ["Listen to the writer's voice note."] : [];
    const boxH = 70 + lines.length * 28;
    const x = (VIDEO_W - boxW) / 2;
    const y = BOTTOM - boxH - 24;
    ctx.fillStyle = "rgba(20, 40, 34, 0.92)";
    roundRect(ctx, x, y, boxW, boxH, 14);
    ctx.fill();
    ctx.fillStyle = "#8be0bd";
    ctx.font = `600 15px ${SANS}`;
    ctx.textBaseline = "top";
    ctx.fillText(voice ? "REFLECTION · voice note" : "REFLECTION", x + 24, y + 20);
    ctx.fillStyle = "#ffffff";
    ctx.font = `20px ${SANS}`;
    lines.forEach((l, i) => ctx.fillText(l, x + 24, y + 48 + i * 28));
  }

  function drawReplay(pos: number, note: Reflection | null) {
    const count = countAt(pos);
    const { doc, range } = engine.frameAt(count);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);
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
      const size = parseInt(L.font.replace(/\D+/, ""), 10);
      L.lines.forEach((line, li) => {
        const y = y0 + p.y + li * L.lineH;
        if (y < TOP - L.lineH || y > BOTTOM + L.lineH) return;
        const x = x0 + L.indent;
        if (range) highlight(line, p.contentStart, x, y, L.lineH, range);
        ctx.fillStyle = C.ink;
        ctx.textBaseline = "top";
        ctx.fillText(line.text, x, y + (L.lineH - size) / 2);
      });
    }
    ctx.restore();

    ctx.fillStyle = C.ink;
    ctx.font = `600 20px ${SANS}`;
    ctx.textBaseline = "middle";
    ctx.fillText(project!.title, 24, 34);
    if (count > 0) {
      const e = events[count - 1];
      ctx.font = `15px ${SANS}`;
      ctx.fillStyle = C.muted;
      const label = `Session ${sessionOf[count - 1]} · ${new Date(e.t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
      ctx.fillText(label, VIDEO_W - 24 - ctx.measureText(label).width, 34);
    }

    const barX = 24;
    const barW = VIDEO_W - 48;
    const barY = VIDEO_H - 30;
    const tot = timeline.total || 1;
    ctx.fillStyle = C.line;
    roundRect(ctx, barX, barY, barW, 6, 3);
    ctx.fill();
    ctx.fillStyle = C.accent;
    roundRect(ctx, barX, barY, Math.max(6, (barW * pos) / tot), 6, 3);
    ctx.fill();
    for (const m of markers) {
      ctx.fillStyle = m.c;
      ctx.fillRect(barX + (barW * m.t) / tot - 1, barY - 6, 3, 6);
    }
    for (const r of refs) {
      ctx.fillStyle = C.note;
      ctx.fillRect(barX + (barW * anchor(r)) / tot - 1, barY - 8, 3, 8);
    }
    ctx.font = `13px ${SANS}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(`Writing process replay · ${Math.round(speed)}× speed`, barX, barY - 16);
    if (note) drawNote(note);
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

  /** Draw the frame for time `ms`; returns the segment shown. */
  function drawAt(ms: number): Seg {
    const seg = segAt(ms);
    if (seg.kind === "intro") drawCard(project!.title, introLines);
    else if (seg.kind === "outro") drawCard("That's the process.", outroLines);
    else if (seg.kind === "note") drawReplay(seg.pos, seg.note);
    else if (seg.kind === "play") drawReplay(seg.from + Math.min(seg.to - seg.from, (ms - seg.start) * speed), null);
    return seg;
  }

  const voiceCues = segs.flatMap((s) => (s.kind === "note" && buffers.has(s.note.id) ? [{ at: s.start + NOTE_AUDIO_DELAY, buf: buffers.get(s.note.id)! }] : []));
  const progress = (ms: number) => opts.onProgress?.({ fraction: Math.min(0.99, ms / totalMs), label: segAt(ms).kind === "note" ? "Adding a reflection…" : "Rendering replay…" });

  const fast = await encodeWithWebCodecs(canvas, totalMs, drawAt, voiceCues, progress, opts.signal);
  if (fast) {
    opts.onProgress?.({ fraction: 1, label: "Done" });
    return fast;
  }
  const slow = await recordRealtime(canvas, totalMs, drawAt, voiceCues, progress, opts.signal);
  opts.onProgress?.({ fraction: 1, label: "Done" });
  return slow;
}

type Cue = { at: number; buf: AudioBuffer };

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
}

/** Mix voice notes into one soundtrack covering the whole video. */
async function mixSoundtrack(totalMs: number, cues: Cue[]): Promise<AudioBuffer> {
  const rate = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil((totalMs / 1000) * rate), rate);
  for (const c of cues) {
    const src = ctx.createBufferSource();
    src.buffer = c.buf;
    src.connect(ctx.destination);
    src.start(c.at / 1000);
  }
  return ctx.startRendering();
}

/** Fast path: render frames as quickly as possible into a standard MP4. */
async function encodeWithWebCodecs(
  canvas: HTMLCanvasElement,
  totalMs: number,
  drawAt: (ms: number) => unknown,
  cues: Cue[],
  progress: (ms: number) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob; ext: string } | null> {
  if (typeof VideoEncoder === "undefined") return null;
  const mb = await import("mediabunny");
  if (!(await mb.canEncodeVideo("avc", { width: VIDEO_W, height: VIDEO_H }))) return null;
  if (!(await mb.canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: 48000 }))) {
    const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
    registerAacEncoder();
  }

  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target: new mb.BufferTarget() });
  const video = new mb.CanvasSource(canvas, { codec: "avc", bitrate: mb.QUALITY_MEDIUM, keyFrameInterval: 2 });
  const audio = new mb.AudioBufferSource({ codec: "aac", bitrate: 128_000 });
  output.addVideoTrack(video, { frameRate: FPS });
  output.addAudioTrack(audio);
  await output.start();
  try {
    const frames = Math.ceil((totalMs / 1000) * FPS);
    let lastYield = performance.now();
    for (let f = 0; f < frames; f++) {
      checkAbort(signal);
      const ms = (f * 1000) / FPS;
      drawAt(ms);
      await video.add(f / FPS, 1 / FPS);
      if (performance.now() - lastYield > 100) {
        progress(ms);
        await new Promise((r) => setTimeout(r, 0)); // let the page update
        lastYield = performance.now();
      }
    }
    checkAbort(signal);
    await audio.add(await mixSoundtrack(totalMs, cues));
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
  const buf = (output.target as InstanceType<typeof mb.BufferTarget>).buffer!;
  return { blob: new Blob([buf], { type: "video/mp4" }), ext: "mp4" };
}

/** Fallback: play the replay in real time and record it with MediaRecorder. */
async function recordRealtime(
  canvas: HTMLCanvasElement,
  totalMs: number,
  drawAt: (ms: number) => unknown,
  cues: Cue[],
  progress: (ms: number) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob; ext: string }> {
  const format = pickVideoFormat();
  if (!format) throw new Error("This browser can't make videos. Try Chrome, Edge, Firefox or Safari.");
  const actx = new AudioContext();
  await actx.resume().catch(() => {});
  const dest = actx.createMediaStreamDestination();
  const silence = actx.createConstantSource();
  silence.offset.value = 0;
  silence.connect(dest);
  silence.start();
  const stream = new MediaStream([...canvas.captureStream(FPS).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const recorder = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((res) => (recorder.onstop = () => res()));
  const pending = [...cues].sort((a, b) => a.at - b.at);

  drawAt(0);
  recorder.start(1000);
  try {
    await new Promise<void>((resolve, reject) => {
      const t0 = performance.now();
      const tick = () => {
        if (signal?.aborted) return reject(new DOMException("Cancelled", "AbortError"));
        const ms = performance.now() - t0;
        while (pending.length && pending[0].at <= ms) {
          const src = actx.createBufferSource();
          src.buffer = pending.shift()!.buf;
          src.connect(dest);
          src.start();
        }
        drawAt(Math.min(ms, totalMs));
        progress(ms);
        if (ms >= totalMs) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  } finally {
    recorder.stop();
    await stopped;
    silence.stop();
    await actx.close();
  }
  return { blob: new Blob(chunks, { type: format.mime.split(";")[0] }), ext: format.ext };
}
