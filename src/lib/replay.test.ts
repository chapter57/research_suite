import assert from "node:assert/strict";
import { test } from "node:test";
import { Transform } from "@tiptap/pm/transform";
import { getDocSchema } from "./schema.ts";
import { buildTimeline, computeStats, countAtTime, IDLE_CAP_MS, ReplayEngine } from "./replay.ts";
import type { RecEvent } from "./types.ts";

const schema = getDocSchema();

/** Simulate a writer: type characters one by one, delete some, paste some. */
function simulate() {
  let doc = schema.topNodeType.createAndFill()!;
  const events: RecEvent[] = [{ type: "session", t: 0 }];
  let t = 1000;
  const push = (tr: Transform, ui?: "paste") => {
    events.push({ type: "steps", t, steps: tr.steps.map((s) => s.toJSON()), ...(ui ? { ui } : {}), inserted: 1 });
    doc = tr.doc;
  };
  const text = "Hello world";
  for (let i = 0; i < text.length; i++) {
    t += 150;
    push(new Transform(doc).insert(1 + i, schema.text(text[i])));
  }
  t += 60_000; // long pause
  push(new Transform(doc).delete(7, 12)); // delete "world"
  t += 200;
  push(new Transform(doc).insert(7, schema.text("there, reader")), "paste");
  // second paragraph
  t += 300;
  const end = doc.content.size;
  push(new Transform(doc).insert(end, schema.nodes.paragraph.create(null, schema.text("Second."))));
  events.push({ type: "ai", t: t + 10, mode: "socratic", question: "q", answer: "a" });
  return { events, finalDoc: doc };
}

test("replay reproduces the final document", () => {
  const { events, finalDoc } = simulate();
  const engine = new ReplayEngine(schema, events, 4); // small checkpoint interval exercises checkpointing
  assert.ok(engine.final().eq(finalDoc));
  assert.equal(engine.final().textContent, "Hello there, readerSecond.");
  assert.equal(engine.failures, 0);
});

test("docAt gives intermediate states, in any order", () => {
  const { events } = simulate();
  const engine = new ReplayEngine(schema, events, 3);
  assert.equal(engine.docAt(6).textContent, "Hello"); // session + 5 chars
  assert.equal(engine.docAt(1).textContent, "");
  assert.equal(engine.docAt(12).textContent, "Hello world");
  assert.equal(engine.docAt(13).textContent, "Hello ");
});

test("frameAt reports the changed range", () => {
  const { events } = simulate();
  const engine = new ReplayEngine(schema, events);
  const { doc, range } = engine.frameAt(14); // the paste
  assert.ok(range);
  assert.equal(doc.textBetween(range.from, range.to), "there, reader");
});

test("timeline compresses long pauses", () => {
  const { events } = simulate();
  const tl = buildTimeline(events);
  assert.equal(tl.times.length, events.length);
  const gap = tl.times[12] - tl.times[11];
  assert.equal(gap, IDLE_CAP_MS);
  assert.equal(countAtTime(tl.times, 0), 1);
  assert.equal(countAtTime(tl.times, tl.total), events.length);
});

test("reset events replace the document", () => {
  const { events } = simulate();
  const replaced = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.text("Fresh start"))).toJSON();
  const engine = new ReplayEngine(schema, [...events, { type: "reset", t: 1e9, doc: replaced, reason: "private" }]);
  assert.equal(engine.final().textContent, "Fresh start");
});

test("stats count pastes and AI exchanges", () => {
  const { events } = simulate();
  const s = computeStats(events);
  assert.equal(s.sessions, 1);
  assert.equal(s.pastes, 1);
  assert.equal(s.aiExchanges, 1);
});
