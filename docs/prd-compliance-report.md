# Vertexon LMS-AI — PRD v1.0 Compliance Report

**Date:** 30 October 2026 · **Release verified:** `v1.1.0` (commit `d68177a`, running in staging and production)
**Supersedes:** the 23 October edition of this report, [`prd-compliance-audit.md`](prd-compliance-audit.md),
and the status tables in [`backend-gap-analysis.md`](backend-gap-analysis.md).

## Verdict

**Every in-scope PRD v1.0 requirement is implemented and verified.**

The three gaps in the 23 October edition are closed:

- **WCAG 2.1 AA** — zero automated violations on 11 screens, in light and dark theme.
- **Video delivery** — HLS adaptive streaming through Cloud CDN.
- **Release process** — a staging environment, with a tagged-release promotion to production.

The fourth item, the missing approve button for AI quizzes, is also closed.

Remaining items are either outside PRD scope or are product metrics that need real users (see
[Not covered](#not-covered)).

| Environment | Frontend | API |
|---|---|---|
| Production | <https://lms-ai-frontend.vercel.app> | `backend-381741146904.us-central1.run.app` |
| Staging | <https://lms-ai-staging.vercel.app> | `backend-staging-381741146904.us-central1.run.app` |

## How this was verified

Each line below was checked between 23 and 30 October 2026 against code or a running system. Nothing is
carried over from earlier documents.

| Method | Covers | Result |
|---|---|---|
| `scripts/verify_prd.py` against **staging** (real Cloud Run, Cloud SQL, Memorystore, Groq/Gemini, Gmail SMTP) | All 29 functional requirements + error format, RBAC, rate limits | **35 / 35** |
| The same script against a full local stack | same | **35 / 35** |
| Playwright + axe-core, 14 screens × light/dark | WCAG 2.1 A/AA | **28 / 28, zero violations** |
| Playwright end-to-end (real browser, real API) | catalog, logins, route guard, account, password reset, flashcards, live classes | **14 / 14** |
| Backend unit tests | | 151 pass |
| Backend integration tests (real Postgres + Redis from empty) | migrations, auth, accounts, email verification, pagination, rate limits, encryption, indexes, v1.1.0 features | 45 pass |
| AI service tests | | 76 pass |
| Frontend tests | | 53 pass |
| Live production checks | migrations, encryption, all 8 lectures streaming, demo accounts verified | all pass |
| Real-browser playback (WebKit) on staging | HLS from CDN | plays; 360p rendition; segments from CDN |
| k6, 100 virtual users | NFR performance | server-side p95 11.9 ms |

CI runs lint, typecheck, unit, integration, end-to-end and accessibility tests on every push. A
failing check blocks the staging deploy — it did once on 23 October, and that is how the
`/auth/me` rate-limit bug below was found.

## §3 Scope

All 14 in-scope items are delivered. On the §3.2 out-of-scope list, only **payments** was built
(Razorpay Standard Checkout: order, verify, webhook, 402 gating). It runs with Razorpay **test-mode**
keys, so test payments work end to end but it has never taken a real payment.

## §5 Functional requirements — 29 / 29

| Module | Requirements | Status |
|---|---|---|
| Student | FR-S1 – S10 | ✅ all ten verified end to end |
| AI tutor | FR-A1 – A8 | ✅ all eight, with real LLM output (7-question quiz draft, 7 flashcards, 2 RAG citations) |
| Instructor | FR-I1 – I6 | ✅ all six. FR-I4: drafts carry an "AI draft" badge and an **Approve & publish** button for the course owner |
| Admin | FR-AD1 – AD5 | ✅ all five. FR-AD2 suspends and restores, but does not hard-delete: a deliberate choice that preserves history |

**AI quiz review** stays as the PRD specifies (FR-A5: generated "for instructor review"). Learners
see an AI quiz only after the instructor approves it.

## §6 Non-functional requirements

| Category | Status | Evidence |
|---|---|---|
| Performance | ✅ | server-side p95 11.9 ms at 100 users |
| Scalability | ✅ | stateless Cloud Run; rate-limit counters and queues in Redis |
| Security | ✅ | bcrypt; 15-min JWT + rotating refresh; RBAC + ownership checks; zod validation; single-use hashed email tokens |
| Availability | ⚠️ monitored | 5-min uptime checks + email alert; too little history to show 99.5 % |
| Data privacy | ✅ | email and phone AES-256-GCM encrypted; `audit_logs`; announcement email uses Bcc |
| **Accessibility** | ✅ **fixed** | 0 axe violations on login, register, catalog, course, dashboard, player, quiz, account, instructor, admin and terms pages, in both themes; enforced in CI |
| Observability | ✅ | JSON logs with request ID across both services; health checks; uptime alerts |
| Caching | ✅ | catalog and course pages 5 min, leaderboard 60 s; CDN for video |
| Rate limiting | ✅ | per PRD §8.9, shared through Redis |

## §7 Database · §8 API

- **§7:** all 34 entities exist; every foreign key is indexed; ivfflat embedding index present.
  Migrations `019` (streaming) and `020` (accounts) are applied in production.
- **§8:** all 40 PRD endpoints exist. Added beyond the PRD: account endpoints, `PUT /quizzes/:id/approve`,
  `POST /admin/videos/backfill`.
- **OpenAPI spec:** valid OpenAPI 3.0.3.

## §9 Architecture · §13 Stack

| Item | Status |
|---|---|
| All five §9.3 background jobs | ✅ (plus video transcoding, all on the always-on worker) |
| **CDN in front of storage (§9.4)** | ✅ **fixed** — HTTPS load balancer + Cloud CDN over the video bucket |
| **HLS adaptive streaming (§13)** | ✅ **fixed** — Transcoder API `preset/web-hd`, or a video-only 360p/720p ladder for silent sources; player uses hls.js, native HLS on Safari, falls back to the original file |
| Substitutions | Groq + Gemini (owner's choice, free) for Anthropic; GCS for S3; Vitest for Jest; Cloud Monitoring for Prometheus/Grafana — see [`architecture.md`](architecture.md) |

## §14 Deployment

| Item | Status |
|---|---|
| Local / **staging** / production | ✅ **staging added**: its own Cloud Run services, worker pool, database (`lms_staging` on the same instance), Redis DB index and Vercel project |
| CI on every push | ✅ lint, typecheck, unit, integration, E2E, accessibility |
| `main` → staging, smoke test | ✅ |
| **Tagged release → production** | ✅ **fixed**: pushing tag `v*` promotes the exact images staging ran; refuses an image staging never built |
| Backups + PITR, managed Redis, secrets manager, bucket lifecycle, SHA rollback | ✅ |

## New features in this release

- **Account settings page (`/account`):** edit name and phone; change email (a confirmation link goes
  to the new address); change password (other devices sign out, this one stays in). Linked from your
  name in the header.
- **Email verification:** sent on sign-up; single-use 24-hour link; a "please verify" banner with a
  resend option; account data refreshes on every page load.
- **Streaming video:** uploads and existing lectures are transcoded and served from the CDN.
- **Staging environment** and a tag-based production release.

## v1.1.0 — features beyond the PRD (24 October 2026)

Re-verified first: `verify_prd.py` still passes **35/35** on staging, so all of PRD v1.0 remains met.
Re-run on 30 October 2026: **35/35** again; all four services healthy, no server errors since the release.
Added afterwards:

| Feature | Where | Verified |
|---|---|---|
| Forgot password (1-hour single-use link, no account enumeration) | `/forgot-password`, `/reset-password` | integration + browser tests |
| Sign in with Google (ID token verified server-side; links by Google subject) | Login / Register | integration tests; **needs a Google OAuth client ID to switch on** |
| Profile photo upload | Account page, header | integration + browser; live on GCS |
| Download my data / delete my account (pseudonymised) | Account page | integration + browser |
| Explain my mistake (RAG-grounded, cached) | Quiz results | integration; live with Groq on staging |
| Spaced-repetition flashcards (SM-2) | `/review`, dashboard | unit + integration; live |
| Socratic tutor mode (+ conversation history) | AI tutor panel | live: asks guiding questions, builds on answers |
| At-risk learner alerts + nudge | Instructor analytics | unit + integration; live |
| Live classes with attendance | Course page | unit + integration + browser; live |

Two quality fixes came out of testing these live: retrieval now ignores material below 0.55
similarity (measured: on-topic 0.66–0.72, unrelated ≤ 0.51), so the tutor no longer cites
lectures that do not cover the question or invents lecture titles; and an admin re-index
(`POST /admin/rag/backfill`) embeds lectures that a seed script inserted without indexing.

## Defects found and fixed in this release

| Defect | Effect | Fix |
|---|---|---|
| Deduplicated queue jobs never re-ran after finishing | **Topic mastery updated only once per learner per course**; failed videos could not be retried | finished jobs cleared before re-queueing |
| Announcement emails listed every recipient in To | Every learner saw every other learner's email | Bcc in batches of 50 |
| Password change revoked the current session | User signed out 15 minutes after changing it | current device gets fresh tokens |
| `/auth/me` shared the 10/min per-IP login limit | A classroom behind one NAT could not sign in | per-user general limit for profile reads |
| Mail sent to impossible addresses | Bounce messages in the sender's inbox | reserved and demo domains are dropped |
| Stale user data in the browser | Verification and renames not reflected until next login | `/auth/me` refreshed on load |
| `preset/web-hd` needs audio | Silent lectures failed to transcode | automatic video-only retry |
| Two fields both labelled "Current password" | Screen readers could not tell them apart | relabelled |
| Muted text below AA contrast, unnamed progress bars, label mismatches | WCAG failures on every page | fixed across 19 files |

## Not covered

| Item | Why |
|---|---|
| §2.3 product KPIs (completion +25 %, retention ≥ 40 %, quiz usability ≥ 85 %) | Need real learners over time; the analytics to measure them exist |
| 99.5 % availability figure | Monitoring is on; there is not yet enough uptime history |
| §3.2 out-of-scope items (mobile apps, plagiarism detection…) | Out of scope by design; live classes were added in v1.1.0 anyway |
| Live payments | Works with Razorpay test-mode keys; real payments need live keys and KYC |
| Accessibility beyond automated checks | axe catches roughly half of WCAG issues; there has been no manual screen-reader pass |

## Reproducing

```bash
python3 scripts/verify_prd.py https://backend-staging-381741146904.us-central1.run.app/api/v1
cd backend && npm run lint && npm test && npm run test:integration
cd e2e && BASE_URL=http://localhost:4173 API_URL=http://localhost:4000/api/v1 npx playwright test
```

`verify_prd.py` creates data. Run it against local or staging, never production.
