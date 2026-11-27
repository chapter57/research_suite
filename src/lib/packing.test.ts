import assert from "node:assert/strict";
import { test } from "node:test";
import { packEvents, unpackEvents } from "./packing.ts";
import type { RecEvent } from "./types.ts";

test("packed chunks round-trip exactly, and old plain chunks still read", async () => {
  const events: RecEvent[] = [
    { type: "session", t: 1 },
    { type: "steps", t: 2, steps: [{ stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: "Héllo “quotes” — ✓" }] } }], inserted: 18 },
    { type: "ai", t: 3, mode: "socratic", question: "Is my claim arguable?", answer: "What would someone who disagrees say?" },
  ];
  const packed = await packEvents(events);
  assert.equal(packed.n, 3);
  assert.deepEqual(await unpackEvents(packed), events);
  assert.deepEqual(await unpackEvents(events), events);
});

test("large chunks compress well", async () => {
  const many: RecEvent[] = Array.from({ length: 1000 }, (_, i) => ({ type: "steps", t: 1e12 + i * 700, steps: [{ stepType: "replace", from: 100 + i, to: 100 + i, slice: { content: [{ type: "text", text: "word " }] } }], inserted: 5 }));
  const packed = await packEvents(many);
  const raw = JSON.stringify(many).length;
  assert.ok(packed.z.length < raw / 5, `${packed.z.length} vs ${raw}`);
});
