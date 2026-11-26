// Replay engine: rebuilds the document at any point in the recording and maps
// recording events onto a compressed playback timeline (long pauses shortened).
import type { Node, Schema } from "@tiptap/pm/model";
import { Step } from "@tiptap/pm/transform";
import type { RecEvent } from "./types.ts";

/** Pauses longer than this are shortened to this in playback. */
export const IDLE_CAP_MS = 1500;
/** Real gaps longer than this are treated as "stepped away" in stats. */
export const ACTIVE_GAP_MS = 2 * 60 * 1000;

export interface Timeline {
  /** Playback time (ms, at 1x) at which event i is applied. */
  times: number[];
  total: number;
}

export function buildTimeline(events: RecEvent[]): Timeline {
  const times: number[] = [];
  let pt = 0;
  for (let i = 0; i < events.length; i++) {
    const gap = i === 0 ? 0 : Math.max(0, events[i].t - events[i - 1].t);
    const cap = events[i].type === "session" ? 800 : IDLE_CAP_MS;
    pt += Math.min(gap, cap);
    times.push(pt);
  }
  return { times, total: pt };
}

/** How many events have been applied at playback time `ms`. */
export function countAtTime(times: number[], ms: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface ChangeRange {
  from: number;
  to: number;
}

export class ReplayEngine {
  private schema: Schema;
  private events: RecEvent[];
  private base: Node;
  private every: number;
  /** Known documents: known.get(n) = the doc after the first n events. */
  private known = new Map<number, Node>();
  private keys: number[] = []; // sorted keys of `known`
  private parsed = new Map<number, Step[]>();
  failures = 0;

  /**
   * @param base the document before the first event (an empty doc by default).
   *   Pass a saved snapshot to replay only the events recorded after it.
   */
  constructor(schema: Schema, events: RecEvent[], checkpointEvery = 200, base?: Node) {
    this.schema = schema;
    this.events = events;
    this.every = checkpointEvery;
    this.base = base ?? schema.topNodeType.createAndFill()!;
    this.seed(0, this.base);
  }

  /** Tell the engine the document after the first `count` events (e.g. a saved snapshot). */
  seed(count: number, doc: Node) {
    if (this.known.has(count)) return;
    this.known.set(count, doc);
    let lo = 0;
    let hi = this.keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.keys[mid] < count) lo = mid + 1;
      else hi = mid;
    }
    this.keys.splice(lo, 0, count);
  }

  get length() {
    return this.events.length;
  }

  private stepsOf(i: number): Step[] {
    let s = this.parsed.get(i);
    if (!s) {
      const e = this.events[i];
      s = e.type === "steps" ? e.steps.map((j) => Step.fromJSON(this.schema, j)) : [];
      this.parsed.set(i, s);
    }
    return s;
  }

  /** Apply event i to doc. Returns the new doc and the changed range, if any. */
  applyEvent(doc: Node, i: number): { doc: Node; range: ChangeRange | null } {
    const e = this.events[i];
    if (e.type === "reset") {
      try {
        const d = this.schema.nodeFromJSON(e.doc);
        return { doc: d, range: null };
      } catch {
        this.failures++;
        return { doc, range: null };
      }
    }
    if (e.type !== "steps") return { doc, range: null };
    let range: ChangeRange | null = null;
    for (const step of this.stepsOf(i)) {
      const res = step.apply(doc);
      if (res.failed || !res.doc) {
        this.failures++;
        continue;
      }
      if (range) range = { from: step.getMap().map(range.from, -1), to: step.getMap().map(range.to, 1) };
      step.getMap().forEach((_oS, _oE, nS, nE) => {
        range = range ? { from: Math.min(range.from, nS), to: Math.max(range.to, nE) } : { from: nS, to: nE };
      });
      doc = res.doc;
    }
    return { doc, range };
  }

  /** The document after the first `count` events. */
  docAt(count: number): Node {
    count = Math.max(0, Math.min(count, this.events.length));
    // Nearest known document at or before `count`.
    let lo = 0;
    let hi = this.keys.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.keys[mid] <= count) lo = mid;
      else hi = mid - 1;
    }
    const start = this.keys[lo];
    let doc = this.known.get(start)!;
    for (let i = start; i < count; i++) {
      doc = this.applyEvent(doc, i).doc;
      if ((i + 1) % this.every === 0) this.seed(i + 1, doc);
    }
    return doc;
  }

  /** The document after `count` events plus the range touched by the last one. */
  frameAt(count: number): { doc: Node; range: ChangeRange | null } {
    if (count <= 0) return { doc: this.base, range: null };
    const before = this.docAt(count - 1);
    return this.applyEvent(before, count - 1);
  }

  final(): Node {
    return this.docAt(this.events.length);
  }
}

export interface ProcessStats {
  sessions: number;
  activeMs: number;
  spanMs: number;
  typedChars: number;
  pastedChars: number;
  pastes: number;
  aiExchanges: number;
  privateGaps: number;
}

export function computeStats(events: RecEvent[]): ProcessStats {
  const s: ProcessStats = { sessions: 0, activeMs: 0, spanMs: 0, typedChars: 0, pastedChars: 0, pastes: 0, aiExchanges: 0, privateGaps: 0 };
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (i > 0) {
      const gap = e.t - events[i - 1].t;
      if (gap > 0 && gap < ACTIVE_GAP_MS && e.type !== "session") s.activeMs += gap;
    }
    if (e.type === "session") s.sessions++;
    else if (e.type === "ai") s.aiExchanges++;
    else if (e.type === "reset" && e.reason === "private") s.privateGaps++;
    else if (e.type === "steps") {
      const n = e.inserted ?? 0;
      if (e.ui === "paste" || e.ui === "drop") {
        s.pastes++;
        s.pastedChars += n;
      } else s.typedChars += n;
    }
  }
  if (events.length > 1) s.spanMs = events[events.length - 1].t - events[0].t;
  return s;
}

export function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return `${Math.round(ms / 1000)}s`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function wordCount(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}
