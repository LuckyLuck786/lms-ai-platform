# Vertexon LMS-AI — Build Status, Improvements & Feature Roadmap

**Date:** 16 October 2026
**Method:** direct code inspection of `backend/`, `frontend/`, `ai-service/`, `docs/`, CI and deploy configs, plus
local verification runs (`tsc --noEmit`, `vitest run`) on the current working tree.
**Companion docs:** [`prd.md`](prd.md) (source of truth), [`prd-compliance-audit.md`](prd-compliance-audit.md) (feature-by-feature
FR audit), [`api-spec.yaml`](api-spec.yaml), [`deploy.md`](deploy.md).

---

## 0. Status update — three decisions taken and implemented

The report below was written first, then three of its four open decisions were answered
and **implemented and verified**. Where this document still reads as "open" (§1, §3, §7),
the corrections below take precedence:

| Decision | Outcome | Where |
|---|---|---|
| **Payments** — finish rather than delete | ✅ **Done.** Router mounted, raw-body webhook, new `POST /payment/verify`, 402 gating on enrolment, checkout UI, demo parity, `RAZORPAY_*` in `.env.example` | `backend/src/modules/payments/payments.router.ts`, `backend/src/db/migrations/014_payments_checkout.sql`, `frontend/src/services/checkout.ts` |
| **Production hardening** next | ✅ **Partially done.** Service-to-service auth + 19 route integration tests landed; E2E, load test, observability still open (§3 items 7–9) | `ai-service/app/main.py`, `ai-service/tests/test_internal_auth.py`, `backend/tests/routes.test.ts` |
| **Deploy truth** — Cloud Run / Cloud SQL | ✅ **Done.** Cloud Run documented as current; Render path relabelled as a legacy alternative | `docs/deploy-cloud-run.md`, `docs/deploy.md`, `README.md` |

**A fourth defect was found while testing** and fixed: `adminRouter.use(authenticate,
requireRole('admin'))` was a blanket guard over all of `/api/v1`, turning unmatched paths
into 403 instead of 404 **and shadowing any router mounted after it** — the actual
mechanism that would have kept payments unreachable even after being "wired". Now scoped
to `/admin/*`, with tests proving all 10 admin routes remain protected.

**Verification after the changes:** backend typecheck clean + **62 tests** (was 43),
frontend typecheck clean + **53 tests** (was 52) + build clean, AI service **43 tests**
(was 33), migration 014 applied and confirmed against `information_schema`, and live HTTP
checks against a real database returning 503 / 402 / 200 / 404 / 403 / 401 as designed.

**Still open from this report:** §3 items 2, 3, 5–13 and the whole of §5.

---

## 1. Executive summary

The platform is **functionally complete against the PRD's in-scope feature set** — all 10 student, 8 AI-tutor,
6 instructor and 5 admin requirements are implemented, all 34 PRD entities exist as migrations, and the API
surface covers every endpoint group.

However, a code-level audit (not just the FR checklist) surfaces a clear split:

| Category | State |
|---|---|
| PRD functional requirements | **Complete** (100 % of in-scope FRs) |
| Code quality / test health | **Good** — typecheck clean, **158 tests green**, no `TODO`/`FIXME` in source |
| **Genuinely unfinished code** | **2 items** — payments and service-to-service auth are now closed (§0); the video-transcription and nightly-recommendation jobs remain |
| **Production hardening** | **Partial** — s2s auth + route tests landed; still no E2E, no load test, no tracing/uptime alerts, secrets in plain env vars |
| **Beyond-PRD features** | **Untouched** — the entire §15 horizon is greenfield |

**The single most important finding (now resolved):** `backend/src/modules/payments/payments.router.ts`
was **never imported or mounted** in `backend/src/app.ts` — 284 lines of dead code, with no checkout UI and
no price check on enrolment. The decision was to finish it rather than delete it; it is now wired end to end
(§0). The cause worth remembering is in §0: it was unreachable because an earlier router's blanket guard
shadowed it.

---

## 2. Verified health snapshot (measured today)

| Check | Command | Result |
|---|---|---|
| Backend typecheck | `backend: npx tsc --noEmit` | **clean** |
| Frontend typecheck | `frontend: npx tsc --noEmit` | **clean** |
| Backend tests | `backend: npm test` | **62 passed / 9 files** (was 43 / 8) |
| Frontend tests | `frontend: npm test` | **53 passed / 2 files** (was 52) |
| AI-service tests | `pytest tests/ -q` | **43 passed / 4 files** (was 33 / 3) |
| Frontend build | `frontend: npm run build` | **clean** |
| Migration 014 | `backend: npm run migrate` | **applied**; columns + 3 indexes confirmed in `information_schema` |
| `TODO` / `FIXME` / `HACK` in source | grep | **0 occurrences** |
| CI workflow | `.github/workflows/ci.yml` | 3 jobs (backend, frontend, ai-service) — typecheck + test + build only; **no deploy stage** |

**Test coverage shape.** The original backend tests were all *pure-unit* (`grading`, `streak`, `mastery`,
`errors`, `password`, `email`, `analytics`, `auth.schemas`) — `supertest` was declared but unused, and nothing
exercised an HTTP route or the error envelope. That gap is now closed by `backend/tests/routes.test.ts`
(**19 route-level tests** covering the app shell, payment mounting, enrolment gating and the admin guard) —
it is the test that found the `adminRouter` blanket-guard defect described in §0. The AI-service suite gained
`test_internal_auth.py` (10 tests). Still absent from both suites: any test that talks to a real Postgres or
Redis instance. The frontend's 53 tests exercise the *in-browser demo backend*, not the real API client.

**Live verification** (not expressible as an automated test, so recorded here): the API was exercised over
HTTP against the local database — payment order → 503 (no gateway keys), paid enrol → 402, status → 200,
unknown path → 404, admin route as student → 403, no token → 401 — plus a controlled experiment flipping one
course's price to show the enrolment gate switch 402 → 201 → 402 with demo state restored afterwards.

---

## 3. What is left to build (unfinished work)

| # | Item | Evidence | Severity | Effort |
|---|---|---|---|---|
| 1 | ~~**Payments module is dead code**~~ **CLOSED (§0)** | Router mounted, checkout UI added, enrolment gated at 402, migration 014 applied, `.env.example` documented, demo mode simulated. *Remaining:* real gateway keys are still unconfigured, so the live happy path is unexercised | ~~Critical~~ **Done** | — |
| 2 | **Video transcription job (PRD §9.3)** | No `transcription` queue in `queues.ts`; no STT/Whisper in `ai-service`; `lectures.transcript` is seeded text only. Lecture upload accepts 512 MB video with no text extraction → uploaded videos are invisible to RAG | High (product gap) | 2–3 d |
| 3 | **Nightly recommendation recalculation (PRD §9.3)** | No cron for `recommendations`; scores are computed on read; `registerStreakCron` is the only scheduler | Medium | 0.5 d |
| 4 | ~~**Service-to-service auth on the AI service**~~ **CLOSED (§0)** | Backend sends `X-Internal-Token` on every AI call; AI service rejects any `/api/v1/ai` request without it via `hmac.compare_digest`; 10 tests in `tests/test_internal_auth.py`. *Remaining:* set `INTERNAL_API_TOKEN` in production and keep Cloud Run `--no-allow-unauthenticated` | ~~High~~ **Done** | — |
| 5 | **Production email delivery** | `SMTP_URL` empty in prod → `sendEmail` logs a dry-run. Code, templates, worker, `POST /admin/email/test` all complete | Medium (config only) | 2 h |
| 6 | **S3/MinIO storage driver** | `storage.ts` implements `gcs` + `local`; the S3 branch is documented as unimplemented; `env.s3.*` config block exists but is unused | Low | 0.5 d |
| 7 | **Playwright E2E suite + deploy stage** | PRD §16.2 names Playwright; CI has no E2E job and no deploy job | Medium | 1–2 d |
| 8 | **Load-test evidence (NFR §6 p95 < 300 ms @ 100 users)** | No k6/Artillery script anywhere | Low | 1 d |
| 9 | **Observability: tracing, metrics, uptime alerts** | Only structured JSON logs + `/health`. No OpenTelemetry, no dashboards, no alerting | Low–Medium | 1 d |
| 10 | **Admin destructive user delete** | Deliberately suspend/restore only (documented deviation) | Low (by design) | — |
| 11 | **i18n sweep completion** | EN/ES/HI scaffolding exists; hardcoded English remains in forum headings and admin labels | Low | 0.5 d |
| 12 | **Accessibility verification (WCAG AA)** | Focus rings + 47 `aria-*` usages, but no axe/Lighthouse run ever recorded | Low | 0.5 d |
| 13 | **PII / column-level encryption** | Not implemented; audit logs and Cloud SQL at-rest encryption only | Low | 1 d |

### Documented deferrals (already reasoned about in `README.md`)
Items 2, 3, 5, 6 are listed under "Known deferrals" in the README with a justification each. Item 2's
justification ("no raw video uploads to transcribe") is **no longer true** — `modules/:id/lectures` accepts a
512 MB `video` upload, stores it in GCS, and never transcribes it. That deferral is now stale.

---

## 4. What can be improved in the existing code

### 4.1 Correctness / small defects
| # | Finding | Where | Impact |
|---|---|---|---|
| A | **Emoji regression** — `'Certificate issued! 🎓'` in the notification title contradicts the completed emoji sweep (backend was supposed to be emoji-free) | `backend/src/jobs/worker.ts:53` | Cosmetic inconsistency in an otherwise emoji-free UI |
| B | **Stale deferral text** — README claims no raw video uploads exist, but the lecture endpoint accepts and stores video | `README.md`, `README.md` §Known deferrals | Misleading documentation |
| C | **Deploy-target contradiction** — `render.yaml` + README describe Render/Neon/Upstash, while the compliance audit and live stack are Cloud Run/Cloud SQL/Memorystore | `render.yaml`, `README.md`, `docs/deploy.md`, `docs/prd-compliance-audit.md` | Onboarding confusion; blueprint may be stale/unused |
| D | **`.env.example` out of date** — missing `GCS_BUCKET` and `RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET` | `.env.example` | New contributors cannot configure storage or payments |
| E | **Redundant Redis connections** — every `getXQueue()` calls `queueConnection()` and builds a fresh `IORedis` client | `backend/src/jobs/queues.ts` | Wasted sockets/connection slots under load |
| F | **Unused `env.s3.*` block** | `backend/src/config/env.ts` | Dead configuration surface |

### 4.2 Security & infrastructure
| # | Finding | Impact |
|---|---|---|
| G | JWT secrets + DB password are inline plain Cloud Run env vars | Credential sprawl; no rotation workflow. **Fix: Secret Manager (~1 d)** |
| H | Cloud SQL reachable from `0.0.0.0/0` | Database exposed to the internet |
| I | Redis (Memorystore VM) without `requirepass` / AUTH | Cache + queue tampering |
| J | AI service internal routes publicly callable | RAG corpus poisoning + LLM bill abuse (same as §3 item 4) |
| K | No rate limiting on the AI service itself (only the backend proxy limits) | Direct hits bypass the 20/min limit |

### 4.3 Scalability & robustness
| # | Finding | Impact |
|---|---|---|
| L | **Background workers run in-process in dev**; on Cloud Run there is no guaranteed standalone worker service | Certificate/email/mastery jobs may not run reliably in prod. **Fix: dedicated worker service or Cloud Tasks** |
| M | Admin/moderation lists hard-capped (`LIMIT 100` / `LIMIT 50`), no pagination or cursors | Truncated data as the platform grows; catalog and forum lists likewise unpaginated |
| N | Embedding ingestion is fire-and-forget inside the request path | A failed ingest leaves a lecture permanently un-RAG'd with no retry/dead-letter |
| O | No correlation/request ID propagated backend → AI service | Impossible to trace a single user action across services |
| P | Frontend has no error boundaries; bundle size never analysed | A render error blanks the app; bundle growth unmonitored |

### 4.4 Testing & CI depth
| # | Finding | Impact |
|---|---|---|
| Q | Zero API/route integration tests despite `supertest` being installed | Route wiring, auth guards and SQL regressions are caught only manually |
| R | No DB migrations test / no schema-drift check | Migration 013 could break silently on a fresh database |
| S | CI has no deploy stage and no per-PR preview deploy (Vercel supports it) | Manual deploys; no release gate |
| T | AI-service tests cover 3 modules out of 7 routers | RAG retrieval, quiz-gen and recommendation logic untested |

---

## 5. Additional features that would enhance the project

Ordered by *product leverage*, grouped by theme. Effort estimates assume the existing architecture absorbs them
without a rewrite (which it does — the PRD split was designed for this).

### A. Credentialing trust — the natural next step from the certificate work
1. **Hash-anchored credentials** — print the PDF's SHA-256 on the document *and* on `/verify/:id` so a recruiter can prove the exact file matches the registry. *(small)*
2. **Public learner portfolio** `/p/:handle` — verified credentials, badges, completed courses; the destination the QR "verify" journey should lead to next. *(medium)*
3. **Open Badges 3.0 / verifiable-credential export + one-click "Add to LinkedIn"**. *(medium)*
4. **Instructor-signed cohort certificates** with an optional institution co-brand block. *(medium)*

### B. AI depth — this platform already has the infrastructure, so it is the highest-leverage differentiator
5. **Socratic tutoring mode** — ask one diagnostic question at a time and grade the learner's reasoning instead of answering. Reuses mastery + RAG; genuinely differentiates from a generic chatbot. *(medium)*
6. **"Explain my mistake"** on every quiz attempt — grounded re-explanation of the specific distractor chosen. *(small)*
7. **Spaced repetition for flashcards** — SM-2 scheduling + a daily review queue on the dashboard. *(medium)*
8. **AI rubric-assisted grading** — draft scores + feedback for short answers; the instructor approves/edits (fits the existing AI-draft-then-approve pattern). *(medium)*
9. **Code/submission sandbox** (Judge0 or Firecracker) for automatic test-case grading of programming assignments. *(large)*
10. **Voice tutor** — Whisper STT + TTS over the same RAG pipeline; this *also* delivers the §9.3 transcription job in §3 item 2, so it is a two-for-one. *(large)*
11. **Streaming responses + prompt/response caching + per-user token budget** — faster perceived answers and bounded LLM cost. *(medium)*

### C. Instructor & growth
12. **Retention funnel analytics** — catalog view → enrol → first lecture → week-2 return → completion, per course. Extends existing analytics with no new data collection. *(medium)*
13. **At-risk learner list with one-click nudge** (notification + email) driven by drop-off and streak signals. *(medium)*
14. **Content versioning + drafts** — edit a lecture without breaking learners mid-course. *(medium)*
15. **Bulk import (SCORM / Moodle zip)** for instructors migrating from another platform. *(large)*
16. **Live sessions** — Zoom/Meet link + attendance tracking, as a lightweight first step toward §15 item 1. *(small–medium)*

### D. Platform & commercialisation
17. **Multi-tenant organisations** — departments/cohorts with SSO (OIDC/SAML), seat management, org-level reporting (PRD §15 item 12). *(large)*
18. **Billing** — this is the natural completion of the dead Razorpay module: subscriptions, one-time purchases, instructor revenue share and payouts. Activates the empty `payments` table and the admin revenue KPI. *(large)*
19. **Public REST API + webhooks** — course-completion events, enrolment sync for partners. *(medium)*
20. **Search upgrade** — Postgres full-text search now; Meilisearch/Typesense when the catalog grows (typo tolerance, facets). *(medium)*
21. **GDPR/compliance pack** — self-service data export + delete-my-account, retention policy for PII and logs. *(medium)*
22. **Coupon codes / affiliate tracking** (PRD §15 item 9). *(medium)*

### E. Engineering quality
23. **Per-PR preview deploys** with the E2E suite running against them. *(small)*
24. **Infrastructure as code** (Terraform/Pulumi) for Cloud Run, Cloud SQL, Redis, buckets — currently created by hand. *(medium)*
25. **Database durability** — automated backups + PITR verification and a documented restore drill. *(small)*
26. **Design-system page** (`/design`) documenting the ink/gold tokens, type scale and components so the aesthetic survives future contributors. *(small)*

---

## 6. Recommended sequencing

**Now — remove incoherence and close the security hole (≈1.5 days)**
1. Decide the fate of the payments module (§3.1) — wire it or delete it. This is the only item that makes the
   codebase *contradict itself*.
2. Service-to-service auth on the AI service (§3.4) + Secret Manager migration (§4.2 G) — highest risk removed per hour.
3. Fix the small defects: emoji regression (§4.1 A), `.env.example` gaps (§4.1 D), stale README deferral (§4.1 B).

**Next sprint — make it defensible (≈4 days)**
4. Real SMTP (§3.5) — 2 h, config only.
5. Playwright E2E + deploy gate (§3.7); first route-level integration tests (§4.4 Q).
6. Transcription/ingestion queue + nightly recommendation recalc (§3.2, §3.3).
7. Observability (OpenTelemetry + uptime alerts, §3.9) and the load-test baseline (§3.8).
8. Pagination on admin/catalog/forum lists (§4.3 M).

**Quarter — differentiate and commercialise (weeks)**
9. Socratic mode + mistake explanations + spaced-repetition flashcards (B5–B7) — the AI features that make the
   platform hard to replace.
10. Retention funnel + at-risk nudges (C12–C13).
11. Finish billing properly (D18) — the real version of the Razorpay module.
12. Orgs/SSO (D17) for institutional deals.

---

## 7. Decisions — status

1. **Payments:** *answered — finish and wire it.* ✅ Implemented, see §0.
2. **Transcription:** still open — build the STT worker, or accept the README deferral (now reworded, because
   the old justification was false: video upload is real and nothing transcribes it). §3 item 2.
3. **Hardening vs features:** *answered — production hardening first.* ✅ Started (§0); observability, E2E and
   load testing remain in §3 items 7–9.
4. **Deploy truth:** *answered — Cloud Run / Cloud SQL.* ✅ Documented in `docs/deploy-cloud-run.md`;
   `render.yaml` and the Render guide are now explicitly labelled a legacy alternative rather than deleted,
   in case they are still used for a staging copy.

---

## 8. Bottom line

Nothing in the PRD's in-scope feature list is missing, and the code is clean enough that `typecheck` and
158 tests pass with no `TODO`s. **(a) the committed-but-unwired payments feature and (c) the service-to-service
auth gap are now closed (§0)**; what remains is **(b) two deferred background jobs** (video transcription and
nightly recommendation recalc) and **(d) the rest of the hardening evidence** — E2E, load testing, tracing and
secrets management — which is where the platform stops being a demo and becomes operable.
