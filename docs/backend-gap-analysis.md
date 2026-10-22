# Vertexon LMS-AI — Backend Gap Analysis vs PRD v1.0

**Date:** 22 October 2026
**Scope:** `backend/` and `ai-service/` only. The frontend is explicitly out of scope for this pass and was
left untouched.
**Method:** direct inspection of the working tree, plus verification runs executed today — `tsc --noEmit`,
`npm test` (backend), `pytest tests/ -q` (ai-service) — and live HTTP probes against the deployed
Cloud Run and Vercel URLs.
**Companion docs:** [`prd.md`](prd.md) (source of truth), [`prd-compliance-audit.md`](prd-compliance-audit.md),
[`build-status-and-roadmap.md`](build-status-and-roadmap.md), [`deploy-cloud-run.md`](deploy-cloud-run.md).

---

## Status update — 23 October 2026

The report below was written on 22 October with the platform offline. Billing
was then re-enabled and the open items were worked through. **Where the body
below reads as open, this table takes precedence.**

| §  | Item | Outcome | Evidence |
|---|---|---|---|
| 0 | Platform offline (billing) | ✅ **Closed** — billing account reopened and linked | `/health` 200 on both services; live login, enrolments, notifications, streak and AI recommendations all 200 |
| 1.1 | "Stale" Cloud Run hostnames | ❌ **Finding withdrawn** — `*-mqkhx6y4xq-uc.a.run.app` and `*-381741146904.us-central1.run.app` are two URL forms of the same service; both answer 200. The login "Network Error" was billing alone | `curl` against both forms |
| 3.3 | Nightly recommendation recalculation | ✅ **Closed** — `POST /api/v1/ai/internal/recommendations/recompute` + BullMQ job scheduler at 02:00 UTC | `recommendation_cron_registered` in worker logs; `tests/recommendations.test.ts`, `tests/test_recommendations_job.py` |
| 3.4 | S3 driver | ✅ **Closed by removal** — the unused `env.s3` config block is deleted; GCS is the production driver | `backend/src/config/env.ts` |
| 3.5 | Production email | ✅ **Closed** — Gmail SMTP via app password, stored as secret `smtp-url` | `POST /admin/email/test` → `{"sent":1}`; `GET /admin/email/status` → `verified: true` |
| 3.6 | Pagination | ✅ **Closed** — `page`/`limit` + `total` on admin users, flagged posts, audit logs, notifications; defaults equal the old caps. Notification `unread` now counts all rows, not the first 50 | `utils/pagination.ts`, `tests/pagination.test.ts`; live `GET /admin/users?limit=2` → `total: 6` |
| 3.8 | Load-test evidence | ✅ **Closed** — server-side p95 **11.9 ms** at 100 VUs (target 300 ms) | `infra/load/k6-core.js`; [`deploy-cloud-run.md` §0](deploy-cloud-run.md) |
| 3.9 | Uptime alerting | ✅ **Closed** — 5-minute uptime checks on both services, email alert policy | Cloud Monitoring |
| 3.10 | Request-ID propagation | ✅ **Closed** — ai-service honours, validates and echoes `X-Request-Id` and logs it per request | `tests/test_recommendations_job.py` |
| 4.1 #2 | Redis `MISCONF` / no AUTH | ✅ **Closed** — moved from the public VM to Memorystore `lms-redis` with AUTH and `noeviction`; VM stopped (not deleted) | worker logs clean |
| 4.1 #3 | Workers dying at scale-to-zero | ✅ **Closed** — Cloud Run worker pool `lms-worker`, 1 always-on instance; API runs with `DISABLE_INLINE_WORKER=1` | `worker_process_ready` in logs |
| 4.2 #7 / 5 D | Secrets as plain env vars | ✅ **Closed** — 8 secrets in Secret Manager; none left as plain env | `gcloud run services describe` |
| 5 A | Cloud SQL open to `0.0.0.0/0` | ✅ **Closed** — services use the Cloud SQL connector socket; authorized networks narrowed to the owner's IP | `gcloud sql instances describe lms-postgres` |
| 5 C | AI service bypassable | ✅ **Closed** — `INTERNAL_API_TOKEN` now set in production (it was unset, so the guard was off); unauthenticated calls return 401 | live probe |
| — | Budget guard | ➕ **Added** — ₹6,000/month budget, alerts at 50/90/100 % before credits | Cloud Billing |

| 3.7 | Playwright E2E + CI deploy | ✅ **Closed** — `e2e/` suite (5 browser tests) and a CI job that runs it against the full stack; `deploy.yml` deploys after green CI on `main`, keyless via Workload Identity Federation | CI run 39837360126: all jobs green |
| 3.11 | PII encryption | ✅ **Closed** — `users.email` is AES-256-GCM ciphertext with an HMAC blind index; production backfilled on boot (7 of 7 rows, 0 plaintext). Admin search by email is now exact-match only | `utils/pii.ts`, migration `015`, `tests/pii.test.ts`, integration suite |
| 3.12 | Integration tests | ✅ **Closed** — `npm run test:integration`: 13 tests against real pgvector Postgres + Redis, from an empty database | CI job "Backend integration" |
| §8 | Per-instance rate limits | ✅ **Closed** — Redis store shared by all instances; general limit keyed by the bearer token's user | `middleware/rateLimit.ts`, integration test |
| — | Backups + PITR | ➕ **Added** — daily automated backups, 7 retained, point-in-time recovery on | Cloud SQL |
| — | Privacy leaks | ➕ **Fixed** — public course detail returned the instructor's email; forum reply notifications showed the replier's email | `courses.service.ts`, `discussions.router.ts` |

**Not built — §4.2 #8 CDN for video.** The media bucket holds 2 KB; all eight
lecture videos are hosted externally. Cloud CDN needs an HTTPS load balancer
(~₹1,500/month), a domain for its certificate, and signed URLs (the bucket
also holds private submissions and certificates). Worth revisiting once
instructors upload video to the platform itself.

Tests after these changes: backend **113 unit + 13 integration**, ai-service
**70 passed, 1 skipped**, **5 Playwright E2E**, backend typecheck clean.

---

## 0. Headline — the platform is feature-complete and currently offline

Two findings dominate everything below.

| Finding | Detail |
|---|---|
| **Backend feature set matches the PRD** | Every endpoint group in PRD §8.1–8.7 is mounted, all 34 §7.1 entities exist across 14 migrations, and the two jobs flagged as missing in the previous report have since been closed in the working tree |
| **Both Cloud Run services return 503** | Decisive log line, emitted today by a probe from this session: `The request failed because billing is disabled for this project.` |

The deployed backend is therefore **not broken code — it is an unpaid project**. `gcloud run services describe
backend` reports `Ready: True` on revision `backend-00010-f8m`; the container is healthy and the platform
refuses to route to it. Nothing in the repository needs to change to fix this.

A second, older cause is also on record and will resurface once billing is restored — Redis on
16 October 2026:

```
MISCONF Redis is configured to save RDB snapshots, but it is currently not able to persist on disk.
```

That is the Memorystore/Redis VM unable to write its RDB file. Queue writes (certificates, email, mastery,
transcription) fail closed while it persists.

---

## 1. Verified health snapshot (measured today)

| Check | Command | Result | vs 16 Oct report |
|---|---|---|---|
| Backend typecheck | `backend: npx tsc --noEmit` | **clean** | unchanged |
| Backend tests | `backend: npm test` | **98 passed / 11 files** | was 62 / 9 |
| AI-service tests | `ai-service: pytest tests/ -q` | **63 passed, 1 skipped** | was 43 / 4 |
| Frontend (deployed) | `GET https://lms-ai-frontend.vercel.app` | **200** | live |
| Backend (deployed) | `GET .../backend/health` | **503** — billing disabled | regression |
| AI service (deployed) | `GET .../ai-service/health` | **503** — billing disabled | regression |

Test counts rose by 36 backend and 20 AI-service tests since the last report, all of it uncommitted. The
working tree is ahead of the documentation that describes it.

### 1.1 Deployed URLs — two sets exist, one is stale

`docs/` and `README.md` reference a hostname that no longer resolves to a live service:

| Service | URL in docs | Actual URL (`gcloud run services list`) |
|---|---|---|
| backend | `https://backend-mqkhx6y4xq-uc.a.run.app` | `https://backend-381741146904.us-central1.run.app` |
| ai-service | `https://ai-service-mqkhx6y4xq-uc.a.run.app` | `https://ai-service-381741146904.us-central1.run.app` |

Both forms currently 503 for the billing reason above, so this is a documentation defect rather than a
routing one — but it will mislead the next person to debug the deployment.

**Frontend (live, verified 200):** <https://lms-ai-frontend.vercel.app>

With the API down, that URL serves the in-browser demo backend from `frontend/src/services/demo/`, not real
data. It is explorable, but every figure on it is seeded.

---

## 2. PRD functional requirements — backend coverage

All 29 in-scope functional requirements have backend support. Spot-verified against code rather than against
the previous audit's checklist:

| PRD group | Requirements | Backend state | Evidence |
|---|---|---|---|
| §5.1 Student | FR-S1 – FR-S10 | Complete | `modules/auth`, `courses`, `enrollments`, `progress`, `quizzes`, `assignments`, `gamification` |
| §5.2 AI Tutor | FR-A1 – FR-A8 | Complete | `modules/ai`, `modules/mastery`, `ai-service/app/routers/*` (8 routers) |
| §5.3 Instructor | FR-I1 – FR-I6 | Complete | `courses.service.ts`, `announcements`, instructor analytics |
| §5.4 Admin | FR-AD1 – FR-AD5 | Complete, one documented deviation | `modules/admin` — suspend/restore only, no destructive delete |
| §7.1 Entities | 34 tables | Complete | migrations `001`–`014` |
| §7.3 Indexing | ivfflat on embeddings | Present | `007_ai_tutor.sql:32` — `USING ivfflat (embedding vector_cosine_ops)` |
| §8.1–8.7 API | all groups | Mounted | `backend/src/app.ts` |
| §8.9 Rate limits | 3 tiers | Present | `middleware/rateLimit.ts` — three 60s-window limiters |

Auth meets §8.1 fully, including the part most projects skip: `/auth/logout` genuinely revokes, via
`revokeRefreshToken` / `revokeAllRefreshTokens` in `auth.service.ts`.

---

## 3. What is actually missing in the backend

Ordered by consequence. Items 1–2 are closures of earlier findings, recorded so the previous report is not
read as current.

| # | Item | Status | Evidence | Effort |
|---|---|---|---|---|
| 1 | ~~Video transcription job (PRD §9.3)~~ | **CLOSED** (uncommitted) | `transcription` queue in `queues.ts:107`, worker in `worker.ts`, caller at `courses.service.ts:438`, `ai-service/app/routers/transcribe.py` (9.6K), `backend/tests/transcription.test.ts` | — |
| 2 | ~~Service-to-service auth~~ | **CLOSED** | `ai-service/app/main.py` rejects any `/api/v1/ai` request without a matching `X-Internal-Token`, compared with `hmac.compare_digest` | — |
| 3 | **Nightly recommendation recalculation (PRD §9.3)** | **OPEN** | `registerStreakCron` is the only scheduler in the codebase; grep for `nightly`/`recommendation` across `backend/src/jobs/` returns nothing. Scores are computed on read | 0.5 d |
| 4 | **S3 storage driver (PRD §13)** | **OPEN** | `utils/storage.ts` implements exactly two drivers, `gcs` and `local` (`storageDriver()` returns that union). There is no S3 branch at all, while `S3_*` keys occupy 7 lines of `.env` — all empty | 0.5 d |
| 5 | **Production email delivery** | **OPEN — config only** | `SMTP_URL` is empty in `.env`, so `sendEmail` logs a dry run. Templates, worker and `POST /admin/email/test` are all finished | 2 h |
| 6 | **Pagination on list endpoints** | **OPEN** | Only `courses.service.ts` paginates. Hard caps elsewhere: `admin.router.ts:120` and `:204` (`LIMIT 100`), `admin.router.ts:229` and `gamification.router.ts:169` and `notifications.router.ts:21` (`LIMIT 50`), `courses.service.ts:195` (`LIMIT 20`). Admin queues and forum lists silently truncate | 1 d |
| 7 | **Playwright E2E + CI deploy stage** | **OPEN** | PRD §16.2 names Playwright; `.github/workflows/ci.yml` has 3 jobs, none E2E, none deploy | 1–2 d |
| 8 | **Load-test evidence (NFR §6: p95 < 300 ms @ 100 users)** | **OPEN** | No k6 or JMeter script in the repository. The headline NFR has never been measured | 1 d |
| 9 | **Observability beyond logs (NFR §6)** | **OPEN** | Structured JSON logs and `/health` exist. No OpenTelemetry, no metrics endpoint, no dashboards, no uptime alerting — which is precisely why the 503 above went unnoticed | 1 d |
| 10 | **Request-ID propagation across services** | **OPEN** | `middleware/requestId.ts` stamps the backend, but the id is not forwarded to the AI service. One user action cannot be traced end to end | 2 h |
| 11 | **PII / column-level encryption (NFR §6)** | **OPEN** | Cloud SQL at-rest encryption and audit logs only | 1 d |
| 12 | **DB/Redis integration tests** | **OPEN** | All 98 backend tests run without Postgres or Redis. Migration `014` could break on a fresh database undetected | 1 d |

### 3.1 The one PRD stack deviation worth naming

PRD §13 and §16.4 specify **Anthropic API (Claude models)** as the LLM provider. `ANTHROPIC_API_KEY` is empty;
`GROQ_API_KEY` and `GEMINI_API_KEY` are set, and `ai-service` auto-detects in Groq → Gemini → Anthropic order.
The platform works, so this is a deliberate substitution rather than a gap — but §13 and the README should say
so, because right now the document and the deployment disagree.

---

## 4. Additional backend services required to complete the project

These are infrastructure and service dependencies, not features. Each is something the PRD assumes exists and
the current deployment either lacks or has left unconfigured.

### 4.1 Required to bring the platform back up

| # | Service | Why | Notes |
|---|---|---|---|
| 1 | **GCP billing re-enabled** on the Cloud Run project | Nothing else on this list matters until it is done | Single blocker for the entire backend |
| 2 | **Managed Redis with working persistence** | The 16 Oct `MISCONF` means queue writes fail. The current instance cannot snapshot to disk | Either fix the VM's disk or move to Memorystore / Upstash. `requirepass` is also unset — see §5 |
| 3 | **Standalone worker service** | Cloud Run scales request containers to zero; in-process workers then stop running. Certificates, email, mastery and transcription are all queue-driven | Dedicated Cloud Run service with `min-instances=1`, or migrate to Cloud Tasks / Cloud Scheduler |

### 4.2 Required by PRD features that are coded but inert

| # | Service | Unblocks | Notes |
|---|---|---|---|
| 4 | **SMTP provider** (Resend, SendGrid, SES) | PRD §5 notifications, certificate email, at-risk nudges | Code is complete; this is one env var |
| 5 | **Speech-to-text provider** (Whisper API or self-hosted) | PRD §9.3 transcription → which gates RAG over uploaded video | Router and queue exist; the provider credential does not |
| 6 | **Embeddings provider** | PRD §16.4 — RAG quality depends on it | `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS` are set; confirm the active provider matches the 1536-dim ivfflat index |
| 7 | **Secret Manager** | PRD §14.3 names a secrets manager | JWT secrets and the DB password are currently plain Cloud Run env vars. `config/secrets.ts` already rejects dev placeholders in production — the storage backend is the missing half |
| 8 | **CDN in front of object storage** | PRD §9.4 and §13 (HLS video delivery) | Not provisioned; video is served straight from the bucket |
| 9 | **Payment gateway keys** (Razorpay) | The payments module is wired and gates enrolment at 402, but the live happy path has never run | Deliberately out of PRD scope (§3.2) — scope decision, not a defect |

### 4.3 Required for the operability the NFRs claim

| # | Service | Covers |
|---|---|---|
| 10 | **Uptime monitoring** (UptimeRobot or equivalent) | PRD §16.6. Would have caught the 503 |
| 11 | **Hosted APM / tracing** (Datadog free tier, New Relic, or OTel + Grafana) | PRD §6 observability, §16.6 |
| 12 | **Container registry retention + IaC** (Terraform/Pulumi) | PRD §14.5 rollback depends on prior images surviving; all infrastructure is currently hand-created |
| 13 | **Automated DB backup + PITR drill** | PRD §14.3 |

---

## 5. Security findings that survive from the previous audit

Re-listed because none has been closed and two are reachable from the public internet once billing resumes.

| # | Finding | Impact |
|---|---|---|
| A | Cloud SQL reachable from `0.0.0.0/0` | Database exposed to the internet |
| B | Redis without `requirepass` / AUTH | Cache and queue tampering |
| C | No rate limiting on the AI service itself | PRD §8.9's 20/min AI-chat limit lives in the backend proxy only; direct hits bypass it. The internal-token guard blocks anonymous callers but does not bound an authenticated one |
| D | Secrets as plain env vars | §4.2 item 7 |

---

## 6. Recommended sequencing

**Now — restore service (hours, mostly outside the codebase)**
1. Re-enable billing on the Cloud Run project.
2. Fix or replace Redis, and set `requirepass`.
3. Stand up the dedicated worker service so queue jobs actually run.
4. Correct the stale Cloud Run hostnames in `docs/` and `README.md`.
5. Commit the 23 modified and 12 untracked files — the transcription work and 56 new tests exist only on disk.

**Next — close the open PRD items (≈4 days)**
6. Nightly recommendation cron (§3.3) and SMTP (§3.5) — 0.5 d and 2 h, the two cheapest closures.
7. Pagination on admin, forum and notification lists (§3.6).
8. Request-ID propagation (§3.10) and observability + uptime alerting (§3.9, §4.3).
9. Load-test baseline against the p95 target (§3.8).
10. Secret Manager migration and the Cloud SQL network restriction (§5 A, D).

**Then — hardening evidence (≈3 days)**
11. Playwright E2E plus a CI deploy gate (§3.7).
12. Integration tests against a real Postgres and Redis (§3.12).
13. S3 driver, if portability off GCP is wanted (§3.4) — otherwise delete the dead `S3_*` config surface.

---

## 7. Bottom line

The backend is not short of features — it is short of a paid cloud project, a worker that stays alive, and the
operational evidence its own non-functional requirements promise. Of the twelve open items in §3, exactly two
are missing product behaviour (the nightly recommendation cron and the S3 driver, the latter arguably obsolete
on GCP). One more is a single environment variable. The remaining nine are hardening and proof — E2E, load,
tracing, pagination, encryption, integration tests — which is the work that separates a demo from something
operable.

The most urgent item is not on the feature list at all: **the deployed platform has been returning 503 to every
caller, and nothing in the stack was configured to tell anyone.**
