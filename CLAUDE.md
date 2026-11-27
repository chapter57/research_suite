# Notes for Claude

- Read `PRINCIPLES.md` before designing features, changing the AI coach's prompts (`src/lib/coach/`), or
  writing student-facing text. It is the project's guiding ethos: writing is thinking, and the app exists to
  strengthen the student's thinking, never to write for them.
- The founder is a writing instructor, not a developer. When they need to do something themselves (GitHub,
  Vercel, Anthropic Console), give one small step at a time with exact button names.
- Production deploys come from the `main` branch via Vercel (https://researchsuites.vercel.app/).
  Keep `main` and `claude/friendly-brahmagupta-ugtxgi` in sync when pushing.
- Before pushing: `npm test`, `npm run typecheck`, and `npm run build` should all pass.
- Cloud: Supabase project `sgfdlgbnnrrtvwcdbbef` (URL and publishable key in `src/config/cloud.ts`; the key is
  public by design). Database tables and owner-only security rules: `supabase/schema.sql`; the founder runs any
  SQL changes in the Supabase SQL Editor. Sign-up uses email + password with email confirmation turned off,
  because Supabase's built-in email only reaches the account owner.
- Sync design (`src/lib/sync.ts`): the browser copy is the working copy; events upload as overlapping chunks
  (the last event is always re-sent). Test accounts created while testing should be listed for the founder to
  delete (Supabase: Authentication -> Users).
- Classes (`supabase/classes.sql`, `src/lib/classes.ts`): only accounts in `public.instructors` can create
  classes (teachers register themselves at sign-up, `supabase/roles.sql`); students join by code via the `join_class` function; instructors
  can read a project only after it is turned in to their class, up to the turned-in `event_count`.
- Course kits (`supabase/kits.sql`, `src/lib/coach/kits.ts`, `src/lib/kitsClient.ts`): a kit is course-level
  (catalog title, ethos, objectives, citation style, guidance), never per-assignment. A class stores a frozen
  copy (`classes.kit`) that can be swapped only until the first student joins (database trigger). The coach
  resolves the kit server-side (`src/lib/coach/kitServer.ts`): class kit, a teacher's own kit, a test kit
  (teachers only), else general writing. Core no-ghostwriting rules always come before kit text.
- Local testing of the coach route against Supabase needs `NODE_USE_ENV_PROXY=1` (the sandbox proxies HTTPS).
