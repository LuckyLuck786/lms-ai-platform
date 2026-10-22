# Vertexon LMS-AI — PRD v1.0 Compliance Report

**Date:** 23 October 2026 · **Commit verified:** `3cda5c0` (deployed to production)
**Supersedes:** [`prd-compliance-audit.md`](prd-compliance-audit.md) and the status tables in
[`backend-gap-analysis.md`](backend-gap-analysis.md).

## Verdict

**The backend is complete against PRD v1.0. The platform as a whole is not yet fully compliant.**
Three PRD requirements are unmet, and all three need either frontend work or new hosting:

1. **Accessibility (NFR §6, WCAG 2.1 AA)** — fails an automated audit: colour contrast on every page
   checked, plus unnamed progress bars on the dashboard. Frontend fixes.
2. **Video delivery (§9.4, §13, §14.3)** — no CDN and no HLS adaptive streaming. Lecture video plays as
   progressive MP4 from an external host.
3. **Release process (§14.1, §14.2)** — no staging environment; `main` deploys straight to production.
   No tagged-release promotion.

One more item works in the API but has no button in the UI: **approving AI-generated quiz drafts**
(FR-I4). Instructors can approve through `PUT /api/v1/quizzes/:id/approve`, but the frontend has no
control for it.

Everything else in PRD sections 3–11 is implemented and was verified against running code, as
described below.

## How this was verified

Nothing below is taken from earlier documents. Each line was checked against code or a running
system on 23 October 2026.

| Method | What it covers | Result |
|---|---|---|
| `scripts/verify_prd.py` — 35 end-to-end checks against a full local stack with **real** Groq/Gemini calls | Every functional requirement (§5) plus error format, RBAC, rate-limit headers | **35 / 35 pass** |
| Live probes against production | Login, catalog, course detail, recommendations, certificates, mastery, AI chat | All 200; AI reply in 0.8 s with 2 citations |
| Production database scan | §7 entities and indexes, PII encryption, migrations | 34/34 tables, 0 unindexed foreign keys, 7/7 emails encrypted |
| Route scan of the code | §8 endpoints | 40/40 |
| Backend unit tests | | 114 pass |
| Backend integration tests (real Postgres + Redis, empty database) | migrations, auth lifecycle, pagination, Redis rate limiting, encryption, §7.3 indexes | 15 pass |
| AI service tests | | 70 pass, 1 skipped |
| Playwright end-to-end (real browser, full stack) | catalog, student and admin login, wrong password, route guard | 5 pass |
| axe-core WCAG 2.1 AA scan | login, register, catalog, student dashboard | **fails** (see §6) |
| k6, 100 virtual users, 60 s | NFR performance | server-side p95 11.9 ms, 0 errors |

CI runs lint, typecheck, unit, integration and end-to-end tests on every push. CI run for `3cda5c0`:
all 5 jobs green, then automatic deploy, all steps green.

## §3 Scope

All 14 in-scope items are delivered. On the out-of-scope list (§3.2), one item was built anyway:
**payments** (Razorpay order, verify, webhook, 402 gating on paid courses). It has no live gateway keys,
so the success path has never run against Razorpay. The other §3.2 items are not built, as the PRD
intends.

## §5 Functional requirements — 29 / 29

Every row was exercised end to end by `verify_prd.py` on 23 October 2026.

### Student

| ID | Requirement | Status | Verified behaviour |
|---|---|---|---|
| FR-S1 | Register / login with JWT | ✅ | register → login → `/auth/me` |
| FR-S2 | Dashboard: courses, % progress, streak | ✅ | 100 % progress and streak returned |
| FR-S3 | Catalog filters + search | ✅ | category, difficulty, rating, text search |
| FR-S4 | Resume position, playback speed | ✅ | 42 s position stored and returned; speed control is in the player |
| FR-S5 | Timestamped notes and bookmarks | ✅ | both created at a timestamp |
| FR-S6 | Assignment upload before deadline | ✅ | ZIP accepted; late submission 403; `.exe` rejected |
| FR-S7 | MCQ, multi-select, short-answer, auto-graded | ✅ | all three types scored, 100 % |
| FR-S8 | Certificate PDF at 100 % | ✅ | issued by the worker, PDF downloads |
| FR-S9 | Badges on milestones | ✅ | first course completed, perfect quiz score |
| FR-S10 | Recommendations | ✅ | ranked suggestions returned |

### AI tutor

| ID | Requirement | Status | Verified behaviour |
|---|---|---|---|
| FR-A1 | Course-scoped chat | ✅ | real LLM reply |
| FR-A2 | RAG-grounded with citations | ✅ | 2 cited lectures from the course |
| FR-A3 | Lecture summary | ✅ | |
| FR-A4 | Study plan from quiz history | ✅ | |
| FR-A5 | Quiz generation (5–10 questions) for review | ✅ | 6-question draft from the LLM, hidden from learners until approved |
| FR-A6 | Beginner / intermediate / advanced | ✅ | mode switch reflected in replies |
| FR-A7 | Flashcards per module | ✅ | 9 cards |
| FR-A8 | Per-topic mastery | ✅ | rows written by the background job |

### Instructor

| ID | Requirement | Status | Verified behaviour |
|---|---|---|---|
| FR-I1 | Create course | ✅ | created as `pending` |
| FR-I2 | Upload video / PDF / slides | ✅ | lectures plus a PDF resource |
| FR-I3 | Assignment with rubric and deadline | ✅ | |
| FR-I4 | Build or approve AI quizzes | ⚠️ **API only** | manual quiz with 3 question types; draft approved through the API — no UI button |
| FR-I5 | Drop-off, average score, time on task | ✅ | |
| FR-I6 | Announcements | ✅ | reaches enrolled students as a notification |

### Admin

| ID | Requirement | Status | Verified behaviour |
|---|---|---|---|
| FR-AD1 | Approve / reject courses | ✅ | pending queue → approve → publicly listed |
| FR-AD2 | View / suspend users | ✅ | suspended user gets 403 at login; restore works |
| FR-AD3 | DAU, enrolments, completion, revenue | ✅ | |
| FR-AD4 | Assign / revoke roles | ✅ | |
| FR-AD5 | Moderate reported posts | ✅ | flag → queue → removed |

FR-AD2 says "view/suspend/**delete**". Accounts can be suspended and restored, but not hard-deleted.
That is a deliberate choice, so enrolments, submissions and audit history keep their owner.

## §6 Non-functional requirements

| Category | Status | Evidence |
|---|---|---|
| Performance (p95 < 300 ms @ 100 users) | ✅ | Server-side p95 11.9 ms, p99 27.6 ms. From India, the client sees ~300 ms because of the round trip to `us-central1`. |
| Scalability (stateless, horizontal) | ✅ | Stateless Cloud Run services (max 3 instances); rate-limit counters and queues in Redis |
| Security | ✅ | bcrypt; 15-min access and rotating refresh tokens; `requireRole` plus ownership checks; zod validation on inputs |
| Availability (99.5 %) | ⚠️ **monitored, not measured** | 5-minute uptime checks with an email alert. There is no history yet to show a 99.5 % figure. |
| Data privacy (PII at rest, audit logs) | ✅ | Emails AES-256-GCM encrypted with a blind index; `audit_logs` table. Names stay plaintext because certificates, leaderboards and forums display them. |
| Accessibility (WCAG 2.1 AA) | ❌ **fails** | axe-core: `color-contrast` on login (13 elements), register (5), catalog (21), dashboard (16); `aria-progressbar-name` (5) and `label-content-name-mismatch` (1) on the dashboard. All frontend. |
| Observability | ✅ | Structured JSON logs in both services; request ID carried from backend to AI service; `/health` on both; uptime checks |
| Caching | ✅ | Catalog and course detail 5 min, leaderboard 60 s, cleared on every change |
| Rate limiting | ✅ | 10/min/IP auth, 20/min/user AI chat, 100/min/user general — shared through Redis |

## §7 Database

| Item | Status | Evidence |
|---|---|---|
| 34 entities | ✅ | all present in production, plus `course_ratings` and `topic_mastery` |
| pgvector | ✅ | v0.8.5 |
| FK indexes | ✅ | 0 unindexed (11 were added in migration `016`) |
| ivfflat embedding index | ✅ | `idx_document_chunks_embedding` |
| Partial index on pending courses | ✅ | |
| GIN index on forum content | n/a | PRD: only "if full-text search is added later" |

## §8 API

| Item | Status | Evidence |
|---|---|---|
| 40 PRD endpoints | ✅ 40 / 40 | `GET /recommendations/me` was added at the PRD path |
| Error format (§8.8) | ✅ | `{error: {code, message, field}}` checked live |
| Rate limits (§8.9) | ✅ | tested against real Redis |
| OpenAPI spec (§10 `docs/api-spec.yaml`) | ✅ | Now valid OpenAPI 3.0.3 (it previously failed to parse); all 40 PRD endpoints documented. Extra routes beyond the PRD are only partly documented. |

## §9 Architecture

Components, AI request flow and caching match the PRD. Details and the substitutions are in
[`architecture.md`](architecture.md).

| Item | Status | Notes |
|---|---|---|
| Core LMS / AI / notification services | ✅ | Notification work runs on the worker pool rather than a separate service |
| API gateway (NGINX) | ✅ substituted | Google Front End terminates TLS; rate limiting is in the app |
| Background jobs (§9.3) — all 5 | ✅ | transcription, ingestion (queued with retries), nightly recommendations, daily streaks, certificates, email |
| CDN in front of storage (§9.4) | ❌ | see "Not met" |

## §10 Folder structure

Matches the PRD layout, including `docs/prd.md`, `docs/api-spec.yaml`, `docs/architecture.md`, and
`.github/workflows/ci.yml` + `deploy.yml`. Differences: `infra/k8s` and `infra/terraform` are absent (both
optional); `infra/nginx` is absent because Cloud Run fronts the services; the frontend has no `hooks/`
folder.

## §11 Roles and permissions

All matrix rows are enforced. Three gaps found during this verification were fixed:

- Students could trigger AI quiz generation. They now get 403.
- Any instructor could read answer keys for any course's quiz. Now only the course's own instructor
  and admins can.
- Unreviewed AI quiz drafts were visible to, and attemptable by, students. They are now hidden until approved.

## §13 Technology stack

Matches the PRD except for these substitutions, all listed in [`architecture.md`](architecture.md):

- **Groq + Gemini instead of Anthropic.** The owner's choice: free tiers. Anthropic remains supported.
- **Google Cloud Storage instead of S3.**
- **Vitest instead of Jest.**
- **Cloud Monitoring instead of Prometheus + Grafana.**
- **No HLS streaming.**

Everything else matches: React 18, Vite, Redux Toolkit, Tailwind, TanStack Query, Express +
TypeScript, FastAPI, Postgres 15 + pgvector, Redis + BullMQ, pdf-lib, Docker, GitHub Actions, Pytest,
Playwright.

## §14 Deployment

| Item | Status | Evidence |
|---|---|---|
| Local environment (Docker Compose) | ✅ | `infra/docker-compose.yml` |
| Staging environment | ❌ | none exists |
| Production on managed containers | ✅ | Cloud Run services + worker pool |
| CI on PR: lint, test, typecheck, build | ✅ | ESLint and ruff added on 23 Oct (the jobs were named "lint" but did not lint). Frontend: typecheck, test, build, no lint. |
| On merge: images, deploy, smoke test | ✅ | keyless (Workload Identity), production only |
| Tagged release → blue-green promotion | ❌ | not implemented |
| Load balancer with TLS | ✅ | Cloud Run |
| Managed Postgres with backups + PITR | ✅ | daily backups, 7 kept, PITR; restore drill passed on 23 Oct |
| Managed Redis | ✅ | Memorystore with AUTH |
| Bucket lifecycle policies | ✅ | incomplete uploads cleared after 1 day; old object versions after 30 days |
| CDN | ❌ | see "Not met" |
| Secrets manager | ✅ | 10 secrets in Secret Manager; none in plain env vars |
| Rollback by commit SHA (§14.5) | ✅ | every image tagged with its SHA |

## §2.3 Success metrics

These are product KPIs that need real users over time, so most cannot be measured yet:

| Metric | Status |
|---|---|
| API p95 < 300 ms | ✅ 11.9 ms server-side |
| AI tutor answer < 10 s | ✅ 0.8 s in production (one sample); local runs were similar |
| Course completion +25 %, 7-day streak retention ≥ 40 % | Needs real learners; analytics to measure them exist (FR-AD3, FR-I5) |
| Quiz generation ≥ 85 % usable | Needs instructor review data; drafts now go through review |

## Not met — detail and options

### 1. Accessibility (WCAG 2.1 AA)

Colour contrast fails in the ink/gold palette across the login, register, catalog and dashboard pages.
The dashboard's progress bars need accessible names. This is about half a day of frontend work: adjust
the token colours and add `aria-label`s, then add an axe check to the Playwright suite so it stays fixed.
**Needs the owner's permission to change the frontend.**

### 2. CDN and HLS video

The media bucket holds about 2 KB. All eight lecture videos are hosted externally on `test-videos.co.uk`.
Cloud CDN requires:

- an HTTPS load balancer (~₹1,500/month),
- a domain for its certificate,
- signed URLs, because the bucket also holds private assignment submissions.

HLS also needs a transcoding step. Worth building once instructors upload video to the platform itself.

### 3. Staging and tagged releases

A second Cloud Run environment, with its own small database, plus a release workflow that promotes the
staging image. Roughly ₹1,000–1,500/month more, mostly for the second Cloud SQL instance.

### 4. FR-I4 approve button

One button on the instructor's view of a draft quiz, calling the existing endpoint. Frontend only.

## Defects found and fixed during this verification

Several of these predate this week and had been reported as complete:

| Defect | Effect | Fix |
|---|---|---|
| Queue job IDs contained `:`, which BullMQ rejects | Topic mastery (FR-A8) **never updated in production** (6 silent failures); video transcription would have failed the same way | IDs use `-`; a test now guards it |
| AI quiz drafts visible to students | Unreviewed AI content reached learners | draft/published status, approval endpoint |
| Any student could generate AI quizzes | LLM cost abuse; drafts written into other people's courses | instructor-owner or admin only |
| Any instructor saw every course's answer keys | Cheating risk | ownership check |
| Certificate URL stored the worker's file path | Server path disclosed to users | download route + data repair |
| Public course page returned the instructor's email | PII leak to anonymous visitors | field removed |
| Forum reply notifications showed the replier's email | PII leak | replier's name instead |
| 11 foreign keys unindexed | Slow joins and deletes as data grows | migration `016` |
| OpenAPI spec did not parse; admin endpoints undocumented | Spec unusable | fixed and completed |
| CI "lint" jobs did not lint | Unused code accumulated | ESLint + ruff gates |
| Embedding ingestion was fire-and-forget | A failure left a lecture out of RAG permanently | queued, 5 retries |

## Reproducing this report

```bash
# full stack locally (Docker Postgres + Redis, backend, ai-service), then:
python3 scripts/verify_prd.py http://localhost:4000/api/v1
cd backend && npm run lint && npm test && npm run test:integration
cd e2e && BASE_URL=http://localhost:4173 npx playwright test
```

Never point `verify_prd.py` at production. It creates courses, users and submissions.
