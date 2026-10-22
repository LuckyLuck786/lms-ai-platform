# PRD Compliance Audit & Improvement Roadmap — Vertexon LMS-AI

**Date:** 11 October 2026
**Source of truth:** [`docs/prd.md`](prd.md) (1186 lines — FR-S1..S10, FR-A1..A8, FR-I1..I6, FR-AD1..AD5, §6 NFRs, §7 schema, §8 API, §9 jobs/caching, §11 RBAC, §14 CI/CD, §15 future work)
**Method:** code inspection of `backend/`, `frontend/`, `ai-service/` + live checks against the deployed stack
(backend revision `backend-00008-6dj`, Vercel `lms-ai-frontend`, Cloud SQL `lms-postgres`).
Every "✅ verified" line below was exercised against production or the local test suites on this date.

---

## 1. Verdict

| Area | Score | Notes |
|---|---|---|
| Student module (FR-S1..S10) | **10/10** | Ratings are now a real feature: `course_ratings`, a star widget, reviews and a catalog rating filter. |
| AI tutor module (FR-A1..A8) | **8/8** | All eight implemented, including RAG citations and topic mastery. |
| Instructor module (FR-I1..I6) | **6/6** | Thumbnail authoring/rendering and a weighted rubric editor were added. |
| Admin module (FR-AD1..AD5) | **5/5** | Approvals, users, metrics, roles, moderation all present. |
| Non-functional (§6) | **partial** | Caching + rate limits + RBAC done; tracing, load-test evidence, media durability, secret handling open. |
| Data model (§7.1) | **34/34 entities** | All PRD tables exist in production (36 total incl. `topic_mastery`, `schema_migrations`). |
| API surface (§8) | **75 endpoints** | Every PRD endpoint group is implemented, plus a few additions. |
| Jobs (§9.3) / Caching (§9.4) | **4/6 jobs, 2/2 caches** | Leaderboard reads are cached (60 s). Video transcription + nightly recommendation recalc still missing. |
| Testing & CI (§14.2, §16.2) | **partial** | 13 test files green in CI; no E2E/Playwright, no deploy stage, no load test. |

**Bottom line:** the build is functionally complete against the PRD's in-scope feature set.
The remaining work is *production hardening* (media durability, service-to-service auth, real
email), two UI gaps that block P0 authoring requirements (thumbnail, rubric), and the
advanced features the PRD parked in §15.

---

## 2. Functional requirements — detailed coverage

### 2.1 Student module

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-S1 | Email+password register/login, JWT session | ✅ | `POST /auth/register|login|refresh|logout`, `GET /auth/me`; bcrypt + 15 m access / 7 d refresh tokens; RBAC middleware. |
| FR-S2 | Dashboard: enrolled courses, % progress, streak | ✅ | `StudentDashboard` renders enrollment cards with progress bars + streak stat; verified live (1 course, 100 %, 7-day streak). |
| FR-S3 | Catalog: category, difficulty, **rating** filters + search | ✅ | `course_ratings` table (migration 013), `GET/POST /courses/:id/ratings`, min-rating filter in the cached catalog query, star ratings on cards, and a rate/review widget with the learner's own rating on the detail page. |
| FR-S4 | Resume position + playback speed | ✅ | `CoursePlayer`: resume from `watched_seconds`, speeds 0.75–2×, progress POSTed every 10 s. |
| FR-S5 | Timestamped notes + bookmarks | ✅ | `notes`/`bookmarks` endpoints; seek-to-timestamp in the UI; delete supported. |
| FR-S6 | Assignment upload (PDF/ZIP/code) before deadline | ✅ | `POST /assignments/:id/submit`; deadline enforced server-side (`assignments.service.ts:71` rejects late submits). |
| FR-S7 | Quiz engine MCQ / multi-select / short-answer + auto-grading | ✅ | `POST /quizzes/:id/attempt` → `POST /attempts/:id/submit`; objective types auto-graded, written answers queued for manual review (score `null`). |
| FR-S8 | Auto certificate PDF at 100 % completion | ✅ **improved today** | Issued by `progress.router.ts` at 100 %; PDF now an engraved A4-landscape document (serial `VTX-YYYY-XXXXXXXX`, embossed seal, signature blocks, QR) rendered on demand from the DB; new **public `GET /certificates/verify/:id`** + frontend **`/verify/:id`** page. Verified end-to-end against production. |
| FR-S9 | Badges: first course, 7-day streak, quiz perfect score | ✅ | `badges` table contains exactly these three; awarded from progress, streak and grading code paths. |
| FR-S10 | Recommendation widget from quiz performance | ✅ | `GET /ai/recommendations` → hybrid engine: category affinity, weak-category coverage (< 70 % avg), difficulty fit, popularity **plus** embedding similarity between the learner profile and candidate courses. |

### 2.2 AI tutor module

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-A1 | Course-scoped chat | ✅ | Sessions per course, adopted on return visits (`AiTutorPanel`). |
| FR-A2 | RAG-grounded answers with citations | ✅ | `document_chunks` + pgvector; replies carry lecture-id + timestamp chips. Verified live against 4 ingested bootcamp transcripts. |
| FR-A3 | Lecture summary | ✅ | `POST /ai/lectures/:id/summarize`. |
| FR-A4 | Study plan from quiz history | ✅ | `POST /ai/study-plan`, grounded in the learner's own enrollments + scores. |
| FR-A5 | Auto-generated quiz (5–10 Q) for instructor review | ✅ | `POST /ai/lectures/:id/generate-quiz` creates a **draft** for instructor approval (FR-I4). |
| FR-A6 | Beginner / Intermediate / Advanced depth | ✅ | Mode switcher persists per session; response returns the depth used. |
| FR-A7 | Flashcards per module | ✅ | `POST /ai/modules/:id/flashcards`, surfaced in the AI tools panel. |
| FR-A8 | Topic mastery driving difficulty | ✅ | `topic_mastery` table + `GET /users/me/mastery`; adaptive ("auto") mode resolves depth from mastery, and quiz difficulty is derived from it when not specified. |

### 2.3 Instructor module

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-I1 | Create course: title, description, category, **thumbnail**, pricing | ✅ | Thumbnail URL field in the instructor form; cover art rendered on catalog rows, course detail hero and the instructor's course list, with a neutral plate when unset. |
| FR-I2 | Upload video / PDF / slide material per lecture | ✅ | Uploads are stored in Google Cloud Storage through `persistFile` and streamed back by the API; the player resolves media URLs against the API origin, so links work from the deployed frontend. |
| FR-I3 | Assignments with **rubric** + deadline | ✅ | Weighted rubric editor (criterion + weight rows, add/remove) posting the structured array the API already validated; deadline still enforced server-side. |
| FR-I4 | Build or approve AI-generated quizzes | ✅ | AI draft → instructor review flow in the content tools. |
| FR-I5 | Per-lecture drop-off, avg quiz score, time-on-task | ✅ | `GET /courses/:id/analytics` + `InstructorAnalytics` (KPIs, drop-off table, quiz table). |
| FR-I6 | Announcements to all enrolled students | ✅ in-app / ⚠️ email | `POST /courses/:id/announcements` fans out notifications to enrolled learners; the email leg is dry-run in production (no `SMTP_URL`). |

### 2.4 Admin module

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-AD1 | Approve/reject submitted courses | ✅ | `GET /admin/courses/pending`, `POST /courses/:id/approve` (approve/reject + reviewer comment). |
| FR-AD2 | View / suspend / delete users | ✅ (subset) | `GET /admin/users`, `PUT /admin/users/:id/suspend` (suspend **and restore**); no destructive delete by design — suspension preserves audit trail. Documented deviation. |
| FR-AD3 | Platform metrics: DAU, enrolments, completion, revenue | ✅ (revenue stub) | `GET /admin/analytics/overview`; revenue sums `payments` rows — the table is never written to because billing is out of scope, so the KPI reads 0. |
| FR-AD4 | Assign/revoke roles | ✅ | `PUT /admin/users/:id/role` with guards (no self-suspend/self-demote). |
| FR-AD5 | Moderate reported posts | ✅ | `GET /admin/moderation/flagged-posts`, `DELETE /admin/moderation/posts/:id`; plus audit-log feed. |

---

## 3. Non-functional requirements (§6)

| Category | Status | Notes |
|---|---|---|
| Performance (p95 < 300 ms @ 100 users) | ⚠️ unmeasured | Catalog reads are Redis-cached and quiz/lecture reads are indexed, but there is no load test or SLO evidence. |
| Scalability / stateless services | ⚠️ | Backend + AI service are stateless and scale on Cloud Run; **media uploads break statelessness** (local disk). |
| Security | ⚠️ strong app-layer, weak infra | bcrypt, short-lived JWT, refresh rotation, RBAC (`requireRole`), zod validation on all inputs, error envelope §8.8. Open: AI-service internal routes are publicly callable; secrets sit in plain Cloud Run env vars; Cloud SQL is exposed on `0.0.0.0/0`. |
| Availability (99.5 %) | ⚠️ | Cloud Run + Cloud SQL health checks; no uptime checks/alerting configured. |
| Data privacy / audit | ✅ baseline | `audit_logs` records admin mutations; Cloud SQL encrypts at rest by default. Column-level PII encryption not implemented. |
| Accessibility (WCAG 2.1 AA) | ⚠️ unaudited | 47 `aria-*` usages, skip link, focus-visible rings, semantic landmarks, keyboard-reachable controls. No axe/Lighthouse run. |
| Observability | ⚠️ | Structured JSON logs (`utils/logger.ts`) and `/health` on backend + AI service. No tracing, metrics dashboards, or alerts. |
| Caching | ⚠️ 1 of 2 | Catalog cache (5 min TTL, invalidated on course create/update/approve) ✅; leaderboard cache (60 s) ❌. |
| Rate limiting | ✅ | `authRateLimiter` 10/min/IP, `aiChatRateLimiter` 20/min/user, `generalRateLimiter` 100/min/user — exactly PRD §8.9. |

---

## 4. Data model & API surface

* **Entities:** every table in PRD §7.1 exists in production — users, roles, user_roles, courses, modules, lectures,
  enrollments, lecture_progress, notes, bookmarks, assignments, assignment_submissions, quizzes, quiz_questions,
  quiz_options, quiz_attempts, quiz_answers, certificates, badges, user_badges, streaks, ai_chat_sessions,
  ai_chat_messages, document_chunks, study_plans, flashcards, recommendations, discussion_threads, discussion_posts,
  announcements, notifications, course_approvals, payments, audit_logs.
  Additions beyond the PRD: **`topic_mastery`** (FR-A8) and `schema_migrations`.
* **API:** 75 REST endpoints across 13 modules (admin, ai, announcements, assignments, auth, courses, discussions,
  enrollments, gamification, mastery, notifications, progress, quizzes) — every group in PRD §8 is covered,
  plus `/certificates/verify/:id`, `/ai/*` generation routes, `/admin/email/status`, and `/lectures/:id/resources`.
* **Integrations:** OpenAI-compatible Groq / Gemini for LLM + embeddings (provider-agnostic resolver, Anthropic path
  present but unkeyed), Redis (cache + BullMQ), Postgres 15 + pgvector.
* **Frontend:** React 18 + Vite + Tailwind + Redux Toolkit + TanStack Query; route-level RBAC; in-browser demo
  backend (52 unit tests) so the SPA runs with no server.

---

## 5. Gaps and risks, ranked

**Closed in the follow-up pass:** media durability (#1, GCS-backed uploads), rating filter and
display (#5, `course_ratings` + widget), course thumbnails (#6, authoring + covers), weighted rubric
authoring (#7), leaderboard caching (#10), markdown rendering for AI replies (#12), skeleton loaders
(#16-adjacent), plus two gaps found while fixing them: uploaded media was unreachable from the
deployed SPA (now resolved against the API origin) and the platform had no terms of service or
privacy policy (both now published and linked from the footer).

The table below lists what remains open.

| # | Severity | Gap | Why it matters | Concrete fix |
|---|---|---|---|---|
| 2 | **Closed 16 Oct** | ~~AI service has no service-to-service auth~~ | The backend now sends `X-Internal-Token` on every AI call and the AI service rejects any `/api/v1/ai` request without it whenever `INTERNAL_API_TOKEN` is set (constant-time compare, covered by `ai-service/tests/test_internal_auth.py`). Cloud Run `--no-allow-unauthenticated` is documented as the outer layer. | Remaining: set the secret in production — see `docs/deploy-cloud-run.md`. |
| 3 | **High** | Production secret hygiene: JWT secrets and DB password inline as env vars; Cloud SQL reachable from `0.0.0.0/0`; Redis VM without AUTH | Credential sprawl; DB/Redis exposed to the internet. | Move to Secret Manager, restrict Cloud SQL authorized networks to the VPC connector, enable `requirepass` on Redis, rotate the exposed credentials. ~1 day. |
| 4 | **Medium** | Email is dry-run in production (`SMTP_URL` empty — code-complete, README lists it as a credentials-only deferral) | FR-I6 and notification emails never leave the app; students miss announcements. | Wire a transactional provider (Resend/SES/SendGrid) via `SMTP_URL`, then assert delivery in an admin-triggered test (`POST /admin/email/test` already exists). ~2 h. |
| 8 | **Medium** | Job coverage: no video transcription, no nightly recommendation recalculation; embedding ingestion is fire-and-forget in the request path | PRD §9.3 lists both; a failed ingest leaves a lecture permanently un-RAG'd (the AI tutor then answers without citations). | Add `transcription` and `ingestion` BullMQ queues consumed by the existing worker (Whisper/`speech-to-text`; retry + dead-letter), plus a nightly cron calling the recommendation rebuild. ~2–3 days. |
| 9 | **Medium** | No E2E/release automation; CI has no deploy stage | PRD §16.2 names Playwright; today regressions are caught only by unit tests and manual checks. | Playwright smoke path: login → catalog → enrol → lecture + note → quiz → certificate download → `/verify/:id`; add a `deploy` job gated on `main`. ~1–2 days. |
| 11 | Low | No tracing/metrics/uptime alerts | Incidents are invisible until a user reports them. | OpenTelemetry + Cloud Monitoring uptime checks on `/health` + log-based error alerts. ~1 day. |
| 13 | Low | Performance NFR unmeasured | §6 target (p95 < 300 ms @ 100 concurrent) has no evidence. | k6/Artillery scenario against staging; publish p95 in `docs/`. ~1 day. |
| 14 | Low | Hardcoded English strings remain (e.g. forum headings, admin labels) | §3.1 says i18n scaffolding — it exists (EN/ES/HI) but the sweep is incomplete. | Move stragglers into `i18n.tsx`; add a lint rule or a test that fails on new literals in JSX text. ~half a day. |
| 15 | **Closed 16 Oct** | ~~Payments table is read-only; admin revenue always 0~~ | Razorpay checkout is now wired end to end (PRD §15 item 4): order → verify/webhook → enrolment, `PAYMENT_REQUIRED` gating on `POST /courses/:id/enroll`, and the revenue KPI sums real successful payments. With no gateway keys the checkout routes return 503 and free courses are unaffected. | Remaining: set `RAZORPAY_*` in production and point the dashboard webhook at `/api/v1/courses/<id>/payment/webhook`. |
| 17 | **Closed 16 Oct** | ~~`adminRouter.use(authenticate, requireRole('admin'))` was a blanket guard on all of `/api/v1`~~ | It turned every unmatched `/api/v1` path into a 403 instead of a 404 and **silently shadowed any router mounted after it** — which is how the payments router shipped unreachable. Now scoped to `/admin/*`, with `backend/tests/routes.test.ts` proving the admin surface is still protected. | Found by the new route-level tests. Worth remembering as a mounting-order hazard. |
| 16 | Low | Accessibility untested | WCAG AA is an NFR; the design pass improved contrast/focus but nothing verifies it. | Run axe-core in the E2E job and fail the build on new violations. ~half a day. |

---

## 6. Beyond §15 — features and improvements worth adding

The PRD's own §15 list (live classes, study groups, plagiarism detection, payments, mobile, offline sync, full i18n,
cohort analytics, marketplace/payouts, adaptive paths, voice tutor, SSO/SAML) is still the right horizon. Below is
what I would add to it, ordered by how much it strengthens the *product story* this build is already telling.

### A. Credentialing trust (natural next step from the certificate work)
1. **Hash-anchored, tamper-evident credentials** — print the PDF's SHA-256 on the document and on `/verify/:id`, so
   a recruiter can prove the exact file matches the registry.
2. **Public learner portfolio** — `/p/:handle` showing verified credentials, badges and completed courses; the
   natural place to point the QR code's "verify" journey next.
3. **One-click "Add to LinkedIn"** and Open Badges 3.0 / verifiable-credential export.
4. **Instructor-signed cohort certificates** with an optional institution co-brand block.

### B. AI depth (the differentiator this platform already has infrastructure for)
5. **Socratic tutoring mode** — instead of answering, ask one diagnostic question at a time, then grade the learner's
   reasoning; reuses mastery + RAG and is a genuine differentiator against generic chatbots.
6. **"Explain my mistake" on every quiz attempt** — grounded re-explanation of the specific distractor chosen.
7. **Spaced repetition for flashcards** (SM-2 scheduling + daily review queue in the dashboard).
8. **AI rubric-assisted grading** — draft scores + feedback for short answers, instructor approves/edits (fits the
   existing review workflow).
9. **Code/submission sandbox** (Judge0 or Firecracker) so programming assignments get automatic test-case grading.
10. **Voice tutor** — Whisper STT + TTS over the same RAG pipeline, which also delivers the §15 transcription job.
11. **Streaming responses + prompt/response caching** — faster perceived answers and a hard per-user token budget to
    contain LLM cost.

### C. Instructor & growth
12. **Retention funnel analytics** — catalog view → enrol → first lecture → week-2 return → completion, per course;
    extends the existing analytics without new data collection.
13. **At-risk learner list with one-click nudge** (notification + email) driven by drop-off and streak signals.
14. **Content versioning + drafts** — instructors edit a lecture without breaking learners mid-course.
15. **Bulk import (SCORM/Moodle zip)** for instructors migrating from other platforms.
16. **Live sessions** via Zoom/Meet link + attendance tracking (lightweight first step to §15).

### D. Platform & commercialization
17. **Multi-tenant organisations** — departments/cohorts with SSO (OIDC/SAML), seat management and org-level reporting.
18. **Billing**: Stripe checkout + subscriptions, instructor revenue share and payouts (activates the currently empty
    `payments` table and the admin revenue KPI).
19. **Public REST API + webhooks** for partner integrations (course-completion events, enrolment sync).
20. **Search upgrade** — Postgres FTS now, Meilisearch/Typesense when the catalog grows; typo tolerance and facets.
21. **GDPR/compliance pack** — data export + delete-my-account self-service, retention policy for PII and logs.

### E. Engineering quality
22. **Preview deploys per PR** (Vercel already supports this) with the E2E suite running against them.
23. **Infrastructure as code** (Terraform/Pulumi) for Cloud Run, Cloud SQL, Redis, buckets — currently created by hand.
24. **Database durability**: automated backups + PITR verification and a documented restore drill.
25. **Design system page** in the app (`/design`) documenting tokens (ink/gold palettes, type scale, components) so
    the aesthetic survives future contributors.

---

## 7. Suggested sequencing

**This week (highest ratio of risk removed to effort)**
1. Object storage for uploads (gap 1) — unblocks durable FR-I2.
2. Service-to-service auth on the AI service (gap 2) + Secret Manager migration (gap 3).
3. Real SMTP (gap 4) and the three UI gaps (5, 6, 7) — small, all P0-adjacent.

**Next sprint**
4. Durable ingestion/transcription queues + nightly recommendation recalc (gap 8).
5. Playwright E2E + deploy stage in CI (gap 9); leaderboard cache (10); markdown chat rendering (12).
6. Observability (11) and the load-test baseline (13).

**Quarter**
7. Socratic mode + mistake explanations + spaced repetition (B5–B7) — the AI features that make the platform
   defensible.
8. Retention funnel + at-risk nudges (C12–C13); Stripe billing (D18); orgs/SSO (D17).

---

## 8. What changed in this pass

### 8.1 Credentials, storage and product gaps

* **Certificate redesign** (`backend/src/utils/certificate.ts`): engraved A4-landscape document — ivory/navy/gold
  palette, double frame with corner diamonds, tracked-caps issuing body, ornamental title rule, gold-underlined
  name, quoted course title, credential serial `VTX-YYYY-XXXXXXXX`, embossed seal, two signature blocks, QR to the
  public verification URL, tamper warning. Rendered on demand from the database, so it works on any Cloud Run
  instance and survives redeploys.
* **Public verification**: `GET /api/v1/certificates/verify/:id` (no auth) + frontend route `/verify/:id` with
  registry styling; the dashboard credential card links to it and shows the serial.
* **Design pass (de-vibe-coding)**: Fraunces/Inter typography, layered ink/gold palettes, a shared component layer
  (`.card`, `.chip`, `.eyebrow`, `.section-title`, `.link-quiet`), dark-mode depth gradients, focus-visible rings, and
  a full emoji→line-icon sweep across student, instructor and admin surfaces.
* **Durable uploads (gap 1, closed)**: `backend/src/utils/storage.ts` gained a GCS driver (`GCS_BUCKET`), the API streams stored objects from `/uploads/*`, and the frontend resolves stored paths against the API origin (`mediaUrl`) - previously uploaded files were both ephemeral *and* unreachable from the deployed SPA. Verified end to end in production.
* **Ratings and reviews (FR-S3, closed)**: new `course_ratings` table + endpoints, catalog rating filter, star rating display and an enrolled-learner review widget.
* **Thumbnails (FR-I1) and weighted rubrics (FR-I3, closed)**: authoring UI plus rendering for the former, a structured criterion/weight editor for the latter.
* **AI replies render markdown** (headings, lists, bold/italic, inline code) through a dependency-free renderer that never uses `dangerouslySetInnerHTML`.
* **Leaderboard caching (PRD §9.4)** added with a 60 s TTL, completing the caching strategy.
* **Skeleton loaders** on the catalog, course detail and dashboard instead of a spinner floating in empty space.
* **Legal pages** (`/terms`, `/privacy`) and footer navigation to them, plus a sign-in page that exposes the working demo accounts in every build.
* Seeded certificate and ratings for the demo dataset so every feature is demonstrable end-to-end.

## 9. Design system: de-vibecoding pass

The interface was rebuilt as a restrained, print-inspired system, and the specific
"generated-looking" tells were removed one by one:

| Tell | Resolution |
|---|---|
| Harsh gradients | Removed everywhere (covers, ribbons, section rules, verification frame); depth now comes from hairline rules. |
| Icon-font pastiche | Decorative icons removed from headings; icons remain only where they carry meaning (controls, file types, status). |
| Pure white surfaces | Warm paper palette: page `#f5f3ee`, cards `#fdfcfa`, sunk `#efece5`; dark mode is a neutral `#0f1115`. |
| Rainbow / neon / pastel | Single institutional blue (`brand`), muted gold accent, semantic red/emerald reserved for errors and success; no pastel chips. |
| Drop shadows | Cards are bordered, not elevated (`shadow-card: none`); only popovers get a restrained `shadow-pop`. |
| Three-up feature grid | Catalog and dashboard listings are two-column, list-shaped layouts. |
| Emojis | Fully swept out of the UI (headings, buttons, statuses, i18n strings). |
| Liquid glass | No `backdrop-blur` anywhere. |
| Em dashes | Removed from all user-facing copy in all three locales. |
| Inter/Geist/Space Grotesk | Replaced with a deliberate pairing: IBM Plex Sans (interface), Source Serif 4 (display), IBM Plex Mono (data). |
| Coloured left stripes | Replaced by small-caps eyebrow labels and hairline section rules. |
| Bento grids / terminal windows / dot grids | None present. |
| Sparkle icons | Removed. |
| Animated arrows / hover motion | No transforms on hover; interaction feedback is colour and border only. |
| Checkmark bullets | No "\u2713" in copy; correctness is shown with icons per answer, not as decoration. |
| "It's not X, it's Y" copy | Not present. |
| No terms of service / privacy policy | Both published and linked from the footer. |
| No real product demo | The live demo accounts are one click away on the sign-in page, and the catalog is public. |
| Basic pastel colours + soft radii | Corner radii reduced to 2-6 px across cards, inputs, buttons and chips. |

## 10. Verification evidence

| Check | Result |
|---|---|
| `backend: npx tsc --noEmit` | clean |
| `frontend: npx tsc --noEmit` / `npm run build` | clean / built (178 modules) |
| `frontend: npx vitest run` | 52 passed |
| Backend revision | `backend-00008-6dj` serving 100 % traffic |
| `GET /api/v1/certificates/verify/f7431b35-…` | `{valid:true, serial:"VTX-2026-F7431B35", …}` |
| `GET /certificates/:id/download` (Bearer) | 200, `application/pdf`, premium layout confirmed visually |
| `https://lms-ai-frontend.vercel.app/verify/f7431b35-…` | renders verified-credential page |
| Dashboard | credential card with serial + Download/Verify actions verified live |
| `POST /courses/:id/ratings` | `{average:5,count:1,...}` then catalog shows "4.7 (3)"; rating filter live |
| Lecture material upload | object present in `gs://lms-media-transitviz/lectures/resources/…`, served back as `application/pdf` (200), missing key returns 404 |
| Material link from the deployed SPA | resolves to `https://backend-…run.app/uploads/…`, browser fetch returns 200 `application/pdf` |
| `/terms`, `/privacy` | render with the paper layout; footer links present |
| `frontend: npm run build` | clean; deployed to `lms-ai-frontend` |
