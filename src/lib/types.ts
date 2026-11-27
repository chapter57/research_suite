// Data model for projects and the process recording.
// The recording is an append-only log of events. The document at any moment
// is rebuilt by replaying the log, so the log is the source of truth.

export type StepJSON = Record<string, unknown>;

/** One editor transaction that changed the document. */
export interface StepsEvent {
  type: "steps";
  t: number; // wall-clock ms
  steps: StepJSON[];
  /** How the change entered: typed (undefined), pasted, cut, or dragged. */
  ui?: "paste" | "cut" | "drop";
  /** Characters inserted by this transaction (for paste stats). */
  inserted?: number;
}

/** A writing session began (page opened). */
export interface SessionEvent {
  type: "session";
  t: number;
}

/** The whole document was replaced: after private writing, a repair, or an import. */
export interface ResetEvent {
  type: "reset";
  t: number;
  doc: Record<string, unknown>;
  reason: "private" | "repair" | "import";
}

/** An exchange with the AI coach, kept in the record for transparency. */
export interface AiEvent {
  type: "ai";
  t: number;
  mode: string;
  badge?: string;
  question: string;
  answer: string;
}

export type RecEvent = StepsEvent | SessionEvent | ResetEvent | AiEvent;

/** A think-aloud note pinned to a moment in the replay. */
export interface Reflection {
  id: string;
  projectId: string;
  /** Number of events applied at the moment the note is pinned to. */
  at: number;
  kind: "text" | "audio";
  text?: string;
  audio?: Blob;
  durationMs?: number;
  createdAt: number;
  /** Uploaded to the cloud. */
  synced?: boolean;
}

export interface Project {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Latest document snapshot (for listing, word counts and export). */
  doc: Record<string, unknown> | null;
  wordCount: number;
  eventCount: number;
  /** Set when the project came from someone else's export (view-only). */
  imported?: boolean;
  author?: string;
  /** Heading details for the MLA-formatted paper. */
  mla?: { name: string; instructor: string; course: string; date: string };
  /** Cloud account that owns this project (absent: this computer only). */
  owner?: string;
  /** How many recording events the cloud has. */
  syncedThrough?: number;
  /** Snapshot last uploaded to the cloud. */
  snapPushedSeq?: number;
}
