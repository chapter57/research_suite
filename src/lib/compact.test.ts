import assert from "node:assert/strict";
import { test } from "node:test";
import { Transform } from "@tiptap/pm/transform";
import { getDocSchema } from "./schema.ts";
import { mergeTyping, startTyping, stepsToJSON, type PendingTyping } from "./compact.ts";
import { ReplayEngine } from "./replay.ts";
import type { RecEvent } from "./types.ts";

const schema = getDocSchema();

/** Type `text` one character at a time (with an occasional backspace), recording like the editor does. */
function typeWithRecorder(text: string, gapMs = 150) {
  let doc = schema.topNodeType.createAndFill()!;
  const events: RecEvent[] = [];
  let pending: PendingTyping | null = null;
  let t = 0;
  const close = () => {
    if (pending) events.push({ type: "steps", t: pending.t, steps: stepsToJSON(pending.steps), inserted: pending.inserted });
    pending = null;
  };
  const apply = (tr: Transform) => {
    t += gapMs;
    if (!(pending && mergeTyping(pending, t, tr.steps, 1))) {
      close();
      pending = startTyping(t, tr.steps, 1);
    }
    doc = tr.doc;
  };
  for (const ch of text) {
    if (ch === "<") apply(new Transform(doc).delete(doc.content.size - 2, doc.content.size - 1));
    else apply(new Transform(doc).insert(doc.content.size - 1, schema.text(ch)));
  }
  close();
  return { events, doc };
}

test("typing is stored one event per word and replays exactly", () => {
  const { events, doc } = typeWithRecorder("Writing is thinkinf<g made visible. ");
  assert.equal(doc.textContent, "Writing is thinking made visible. ");
  assert.equal(events.length, 5); // five words
  const replayed = new ReplayEngine(schema, events).final();
  assert.ok(replayed.eq(doc));
});

test("a long pause starts a new event mid-word", () => {
  const { events } = typeWithRecorder("abcdef", 2500);
  assert.equal(events.length, 6);
});

test("replay can start from a saved snapshot", () => {
  const { events, doc } = typeWithRecorder("one two three four five ");
  const engine = new ReplayEngine(schema, events);
  const mid = engine.docAt(2);
  const fromSnapshot = new ReplayEngine(schema, events.slice(2), 200, mid).final();
  assert.ok(fromSnapshot.eq(doc));
  const seeded = new ReplayEngine(schema, events);
  seeded.seed(2, mid);
  assert.ok(seeded.docAt(4).eq(engine.docAt(4)));
});
