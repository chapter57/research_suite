# Research Suite

A writing studio for student research projects. It records the writing process, lets students replay it and pin
voice or text reflections to key moments, and has an AI writing coach that can be switched on and off. The coach
helps students think, read, research and revise. It does not write for them.

The first course pack is **ENGL 102: Composition and Critical Reading**, built around the course's skill badges
(Reading Actively, Critiquing, Analyzing, Synthesizing II, Imagining Readers, Shifting Styles II, Paragraphing II).

**Live site:** https://researchsuites.vercel.app/ (deployed by Vercel from the `main` branch).

**User's manual:** [Research Suite v1 — User's Manual](https://claude.ai/artifact/GNbbEEJmcCGmwdpzcy8URr) (for students and instructors).

## What's in version 1.0

| Feature | Status |
|---|---|
| Editor (headings, lists, quotes, undo, print/save as PDF) | ✅ |
| Process recording: every edit, paste, coach exchange and session, with timestamps | ✅ |
| Private mode (pauses detailed recording; the replay shows a labeled jump) | ✅ |
| Replay player: scrub, 1–32× speed, long pauses shortened, change highlighting | ✅ |
| Timeline markers: pastes, coach exchanges, sessions, private writing, reflections | ✅ |
| Reflections: voice or text notes pinned to moments; playback stops at them | ✅ |
| Process stats (sessions, active time, typed vs. pasted, coach use) | ✅ |
| AI coach: 5 modes, course-skill focus, on/off toggle, no-copy panel, daily limit | ✅ |
| Download: MLA paper (Word, PDF), replay video (MP4), project file for Moodle | ✅ |
| Accounts and cloud saving: sign in, work syncs between computers (Supabase) | ✅ |
| Instructor dashboard, Moodle (LTI) integration | Planned |

Work is kept in the student's browser (IndexedDB) and, when signed in, synced to their account in the cloud
(Supabase; tables and security rules in `supabase/schema.sql`). Students export to submit. An instructor opens a submitted file with **Open a shared recording…** on the home page.

## Running it

Requires Node 20+.

```bash
npm install
cp .env.example .env.local   # then add your ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

Everything except the coach works without an API key.

```bash
npm test          # replay engine tests
npm run typecheck
npm run build
```

## The AI coach

- The API key stays on the server (`src/app/api/coach/route.ts`). Students never see it.
- `COACH_MODEL` picks the model. The default is `claude-haiku-5-5` (a few dollars a term for one class). `claude-sonnet-5-5` and `claude-opus-5-5` are stronger and cost more.
- `COACH_DAILY_LIMIT` caps requests per browser per day.
- Course policy (coach on by default? which modes? block copying?) is in `src/config/course.ts`.
- Modes and their instructions: `src/lib/coach/modes.ts`. Core rules: `src/lib/coach/prompt.ts`.
- Course skills: `src/lib/coach/packs.ts`. Add another course by adding a pack.
- Every coach exchange is saved in the student's process recording.

## How the recording works

The editor (TipTap/ProseMirror) records each document change as a list of *steps* with a timestamp
(`src/components/Writer.tsx`). The log is append-only, and the document is rebuilt by replaying it, so the
recording and the paper can't drift apart. `src/lib/replay.ts` replays to any point (with checkpoints, so
scrubbing is fast) and builds the playback timeline.

## Roadmap to May

1. **Dec–Jan:** accounts and cloud sync (Supabase), autosave across devices.
2. **Feb:** instructor view: class roster, open any student's replay, assignment settings.
3. **Mar:** Moodle LTI 1.3 launch and grade passback; source library and MLA citation helper.
4. **Apr:** pilot with test students; accessibility and privacy review; hosting.
5. **May:** launch.

