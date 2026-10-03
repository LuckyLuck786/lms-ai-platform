# LMS-AI Platform — Vertexon Learning Technologies

AI-augmented Learning Management System: conventional course authoring,
assessments, gamification, and an embedded RAG-based AI tutor grounded in each
course's own material. Built per the PRD (`49555bfb75891548eb4433e25b2bdb8c.docx`).

## Monorepo layout

```
frontend/    React 18 + TypeScript + Vite + Tailwind + Redux Toolkit + TanStack Query
backend/     Node.js + Express + TypeScript — core LMS REST API (/api/v1)
ai-service/  Python + FastAPI — RAG pipeline, embeddings, Claude integration
infra/       docker-compose.yml (Postgres 15 + pgvector, Redis, MinIO), nginx, k8s
.github/     CI pipeline (lint, typecheck, tests)
docs/        PRD + API spec
```

## Quick start (Phase 1)

```bash
# 1. Copy environment template
cp .env.example .env

# 2. Start the data layer (Postgres + pgvector, Redis; add --profile storage for MinIO)
docker compose --env-file .env -f infra/docker-compose.yml up -d

# 3. Apply database migrations
cd backend && npm install && npm run migrate

# 4. Run the API (http://localhost:4000)
npm run dev

# 5. Run the frontend (http://localhost:5173) in a second terminal
cd frontend && npm install && npm run dev
```

Full stack in one command (after `cp .env.example .env`):

```bash
docker compose --env-file .env -f infra/docker-compose.yml --profile app up --build
```

## API conventions

- Base URL: `/api/v1`
- All endpoints except `/auth/*` and the public catalog require
  `Authorization: Bearer <JWT>`
- Rate limits: `/auth/*` 10/min/IP, `/ai/chat/*` 20/min/user, everything else
  100/min/user
- Standard error envelope:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "email must be a valid email address", "field": "email" } }
```

## Phase 1 status (Week 1 milestone)

- [x] Monorepo scaffold + Docker Compose (Postgres/pgvector, Redis, MinIO)
- [x] Full PRD DDL migrations (`backend/src/db/migrations/001..011`)
- [x] Auth: register / login / refresh (rotating) / logout / me, bcrypt, JWT
- [x] RBAC middleware (`authenticate`, `requireRole`) + audit-friendly logging
- [x] Course CRUD, public catalog filters + Redis caching, approval workflow
- [x] Enrollment endpoints (`POST /courses/:id/enroll`, `GET /enrollments/me`)
- [x] React scaffold: auth pages, protected routes, student dashboard, catalog,
      instructor workspace, dark mode
- [x] FastAPI AI service scaffold with route stubs for Phase 3
- [x] GitHub Actions CI

## Phase 2 status (Week 2 milestone)

- [x] Course player: resume-from-position, playback speed, watched-seconds
      reporting with enrollment progress recompute (FR-S4)
- [x] Timestamped notes + bookmarks CRUD (FR-S5)
- [x] Manual quiz builder + attempts + auto-grading for MCQ/multi-select,
      short-answer left for manual grading (FR-S7, tested in `tests/grading.test.ts`)
- [x] Assignments: instructor creation (rubric + deadline), multipart file
      submission before due date, instructor grading (FR-S6/FR-I3)
- [x] Streaks (activity touch + daily BullMQ cron at 03:00 UTC) and milestone
      badges with notifications (FR-S9, `tests/streak.test.ts`)
- [x] Certificate PDF auto-generation at 100% completion via BullMQ worker
      (pdf-lib), authenticated download endpoint (FR-S8)
- [x] Frontend: course player, quiz-taking UI, inline assignment submission,
      real streak/badges/certificates on dashboard, instructor content tools
      (modules, lectures, quiz builder, assignments)
- [x] `scripts/smoke.sh` + `scripts/smoke-phase2.sh` end-to-end verification

Roadmap: all four phases implemented — see the status sections above.

## Phase 4 status (Week 4 milestone)

- [x] Admin panel: platform metrics (DAU, enrollments, completion rate,
      revenue, flagged posts), user search, role assignment with refresh-token
      revocation, suspend/restore, approval queue, flagged-post moderation,
      audit log (`scripts/smoke-phase4.sh`)
- [x] Threaded discussion forum per course: threads, replies, flagging,
      instructor/admin removal (FR-AD5)
- [x] Announcements with fan-out: in-app notifications to every enrolled
      student + queued email dispatch (nodemailer; dry-run log without SMTP_URL)
- [x] Notification bell with unread badge, mark-one/mark-all-read
- [x] i18n scaffolding (EN/ES/HI nav strings, `useI18n`, localStorage-persisted)
      and accessibility pass: skip-to-content link, ARIA labels, focus styles,
      role=progressbar/alert/status landmarks, dark mode
- [x] Demo seeder: `npm run seed` (idempotent) — admin/instructor/2 students,
      approved course with transcripted lectures, quiz, thread, announcement
      (password: `DemoPass123!`)
- [x] CI hardened: real `pytest` run for the AI service (no `|| true`)
- [x] GitHub Actions workflow: backend typecheck+test, frontend typecheck+build,
      ai-service compile+test

### Run the full stack locally

```bash
cp .env.example .env
docker compose --env-file .env -f infra/docker-compose.yml up -d   # postgres + redis
cd backend && npm install && npm run migrate && npm run seed && npm run dev
cd ai-service && .venv/bin/uvicorn app.main:app --port 8000         # 2nd terminal
cd frontend && npm install && npm run dev                           # 3rd terminal
```

Or everything in Docker: `docker compose --env-file .env -f infra/docker-compose.yml --profile app up --build`.

Demo accounts (after `npm run seed`): `admin@vertexon.demo`,
`instructor@vertexon.demo`, `student@vertexon.demo` — all `DemoPass123!`.

## Phase 3 status (Week 3 milestone)

- [x] Ingestion pipeline: transcript → overlapping chunks → 1536-dim embeddings
      → pgvector, triggered automatically on lecture creation, re-ingest is
      idempotent (`POST /api/v1/ai/internal/ingest`)
- [x] RAG chat: course-filtered cosine retrieval → mode-aware prompt → Claude,
      replies persisted with lecture citations (title + estimated timestamp);
      20 req/min/user rate limit enforced at the Node proxy
- [x] Difficulty modes: beginner / intermediate / advanced (`PUT .../mode`)
- [x] Lecture summaries, AI quiz drafts (is_ai_generated, instructor review),
      module flashcards, rule-based study plans from quiz history
- [x] Recommendation engine: quiz-performance signals + embedding similarity
      over candidate courses, persisted to the `recommendations` table
- [x] Frontend: AI tutor chat panel with citation chips + mode switcher,
      AI tools (summarize / flashcards / quiz draft / study plan) in the player,
      “Recommended for you” widget on the dashboard
- [x] `scripts/smoke-phase3.sh` end-to-end verification; `pytest` (7 tests)

### LLM providers

The AI service picks a provider automatically, in this order:

| Priority | Provider | Default model | Notes |
|---|---|---|---|
| 1 | **Groq** (`GROQ_API_KEY`) | `llama-3.3-70b-versatile` | free tier, fastest |
| 2 | **Gemini** (`GEMINI_API_KEY`) | `gemini-2.0-flash` | free tier; also powers embeddings (`text-embedding-004`, zero-padded to 1536 — cosine-preserving) |
| 3 | Anthropic (`ANTHROPIC_API_KEY`) | `claude-sonnet-4-5` | paid |

Set any key in `.env` and chat/summaries/quiz-gen/flashcards switch from the
offline demo mode to real LLM output — no code changes needed. Every provider
call is wrapped so an outage degrades to the extractive fallback instead of
failing the request. See [llm.py](ai-service/app/core/llm.py) and
[embeddings.py](ai-service/app/rag/embeddings.py).

Run the AI service locally:

```bash
cd ai-service && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8000   # separate terminal
```

### Background jobs

Dev runs queue workers in-process (`DISABLE_INLINE_WORKER=1` to opt out).
In production run `npm run worker` alongside the API. Streak evaluation is a
repeatable BullMQ job (03:00 UTC); certificate PDFs generate async on demand.

## Demo mode (no backend required)

The frontend ships with an in-browser implementation of the `/api/v1` surface
(`frontend/src/services/demo/`). When no API base URL is configured — a static
host such as Vercel, or a laptop without Docker running — axios is pointed at
that adapter instead of the network, so every screen renders real-looking data
instead of an error:

- the login screen offers one-click sign-in as **student**, **instructor** or
  **admin** (password `DemoPass123!`);
- catalog, course detail, forum, player, quizzes, assignments, notifications,
  badges, certificates and the admin panel all work, including mutations
  (enrol, post, flag, moderate, create courses, auto-grading);
- the AI tutor answers with transcript citations, computed by lexical overlap
  rather than a model call, and says so in the reply;
- certificate downloads return a real (plain) PDF.

Override it in either direction:

| Setting | Effect |
|---|---|
| `VITE_API_BASE_URL=https://api.example.com/api/v1` | always call a real API |
| `VITE_DEMO_MODE=true` | force demo mode (handy in `npm run dev`) |
| `VITE_DEMO_MODE=false` | force real mode |
| `?demo=off` / `?demo=on` in the URL | runtime escape hatch on a deployed site |

Defaults: **off** during `vite dev` (the proxy to `localhost:4000` is expected
to be running) and **on** for production builds without an absolute
`VITE_API_BASE_URL`.

The adapter is held to the real contract by `frontend/src/services/demo/server.test.ts`
(auth, RBAC, enrolment rules, grading parity with `backend/src/utils/grading.ts`,
PDF output), so the demo cannot quietly drift from the API.

## Testing

```bash
cd backend && npm test        # vitest: grading, streaks, errors, schemas
cd frontend && npm test       # vitest: demo backend contract tests
cd frontend && npm run build  # typecheck + production build
cd ai-service && pytest       # RAG chunking, LLM provider resolution

# End-to-end smoke (data layer + migrated + backend running):
bash scripts/smoke.sh          # Phase 1: auth, RBAC, catalog, enrollment
bash scripts/smoke-phase2.sh   # Phase 2: progress, quizzes, assignments, certificate
bash scripts/smoke-phase3.sh   # Phase 3: ingestion, RAG chat, AI generation (needs ai-service)
bash scripts/smoke-phase4.sh   # Phase 4: admin, forum, moderation, notifications
```
