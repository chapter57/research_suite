# Notes for Claude

- Read `PRINCIPLES.md` before designing features, changing the AI coach's prompts (`src/lib/coach/`), or
  writing student-facing text. It is the project's guiding ethos: writing is thinking, and the app exists to
  strengthen the student's thinking, never to write for them.
- The founder is a writing instructor, not a developer. When they need to do something themselves (GitHub,
  Vercel, Anthropic Console), give one small step at a time with exact button names.
- Production deploys come from the `main` branch via Vercel (https://researchsuites.vercel.app/).
  Keep `main` and `claude/friendly-brahmagupta-ugtxgi` in sync when pushing.
- Before pushing: `npm test`, `npm run typecheck`, and `npm run build` should all pass.
