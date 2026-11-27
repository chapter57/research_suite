// Compression for recording chunks stored in the cloud. A packed chunk is
// {"z": base64(gzip(JSON array)), "n": number of events}; older chunks are
// plain JSON arrays and are still read as-is.
import type { RecEvent } from "./types.ts";

export interface PackedChunk {
  z: string;
  n: number;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}

export async function packEvents(events: RecEvent[]): Promise<PackedChunk> {
  const raw = new TextEncoder().encode(JSON.stringify(events));
  return { z: toBase64(await pipe(raw, new CompressionStream("gzip"))), n: events.length };
}

export async function unpackEvents(stored: unknown): Promise<RecEvent[]> {
  if (Array.isArray(stored)) return stored as RecEvent[];
  const packed = stored as PackedChunk;
  if (!packed || typeof packed.z !== "string") throw new Error("Unreadable recording chunk.");
  const raw = await pipe(fromBase64(packed.z), new DecompressionStream("gzip"));
  return JSON.parse(new TextDecoder().decode(raw)) as RecEvent[];
}
