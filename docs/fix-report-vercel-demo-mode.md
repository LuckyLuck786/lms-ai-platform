# Fix Report — "Frontend still in demo mode" (2026-10-11)

## Symptom

`https://lms-ai-frontend.vercel.app` showed the amber "Demo mode — no backend is
configured" banner and served the in-browser sample database (5 courses, Riya
Sharma) instead of the live Cloud Run backend. Visiting the backend/AI-service
root URLs returned `NOT_FOUND` / `Not Found`, which looked like broken services.

## Root causes

1. **Wrong Vercel project.** The team owns two Vercel projects:
   - `frontend` → `frontend-rho-eight-57.vercel.app` (the CLI had auto-linked here)
   - `lms-ai-frontend` → `lms-ai-frontend.vercel.app` (the real production alias)
   The earlier `vercel --prod` deploy therefore updated the *wrong* project.
   The production project was still serving a **7-day-old build**.
2. **No env vars on the production project.** `lms-ai-frontend` had **zero**
   environment variables, so its build fell back to demo mode
   (`isDemoMode()` is true when no absolute `VITE_API_BASE_URL` is inlined).

## Fix applied

```bash
cd frontend
rm -rf .vercel                                   # drop the wrong link
npx vercel link --yes --project lms-ai-frontend  # link to the real project
echo "https://backend-mqkhx6y4xq-uc.a.run.app/api/v1" | npx vercel env add VITE_API_BASE_URL production --yes
echo "false"                                          | npx vercel env add VITE_DEMO_MODE production --yes
npx vercel --prod --yes                          # aliased to lms-ai-frontend.vercel.app
```

Additionally, both Cloud Run services gained a human-friendly root route
(`GET /` returns service metadata JSON) so their root URLs no longer look broken:

- Backend: edited `backend/src/app.ts` → redeployed revision `backend-00007-9t2`
- AI service: edited `ai-service/app/main.py` → redeployed revision `ai-service-00002-zgk`

## Data fix — RAG ingestion

`document_chunks` was empty, so the AI tutor answered with the "not covered by
the course material" fallback. Ingested all four seeded lecture transcripts via
`POST /api/v1/ai/internal/ingest`:

| Lecture | Chunks | Embedded |
|---|---|---|
| Designing REST APIs with Express | 1 | yes |
| PostgreSQL Indexing & Query Plans | 1 | yes |
| React Components & Props | 1 | yes |
| State Management with Redux Toolkit | 1 | yes |

## Verification (all in a real browser on the live site)

- No demo banner; clean login page.
- Logged in as `student@vertexon.demo` → dashboard shows the **real** course
  ("Full-Stack Web Development Bootcamp", 1 course, 100% progress, streak 7).
- Network log: `POST /api/v1/auth/login → 200`, then `enrollments/me`, `streak`,
  `badges`, `certificates`, `notifications`, `ai/recommendations` all `→ 200`
  against `backend-mqkhx6y4xq-uc.a.run.app`.
- Course page, lecture player, quiz list, announcements and discussion all
  render live data.
- AI Tutor answered *"What HTTP verbs map to which REST operations?"* with a
  grounded, LLM-generated answer citing **Designing REST APIs with Express**
  (plus citation chips for all four lectures).
- `GET https://backend-mqkhx6y4xq-uc.a.run.app/` and
  `GET https://ai-service-mqkhx6y4xq-uc.a.run.app/` both return service JSON.

## Remaining polish (not blocking)

- AI replies render raw Markdown (`**bold**`, `|` tables) instead of formatted
  text — the chat bubble has no Markdown renderer.
- The stray `frontend` Vercel project still exists; harmless, can be deleted in
  the dashboard later.
