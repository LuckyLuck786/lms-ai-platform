# Vertexon LMS-AI — Architecture

PRD §9 describes the intended architecture; this is what is built and running.
Deployment detail (resource names, secrets, redeploy commands) lives in
[`deploy-cloud-run.md`](deploy-cloud-run.md).

## Components

```
                   Browser — React 18 SPA (Vercel: lms-ai-frontend)
                                     │ HTTPS, JSON, Bearer JWT
                                     ▼
              Google Front End (TLS termination, Cloud Run load balancing)
                                     │
            ┌────────────────────────┴──────────────────────────┐
            ▼                                                   │
  backend  (Cloud Run, Node 20 / Express / TypeScript)          │
  auth, RBAC, courses, enrolment, progress, quizzes,            │
  assignments, gamification, forum, notifications,              │
  admin, payments · rate limits (Redis store) ·                 │
  caching · AI proxy (adds X-Internal-Token)                    │
            │                        │ HTTPS + X-Internal-Token │
            │                        ▼                          │
            │          ai-service (Cloud Run, Python / FastAPI) │
            │          RAG chat, summaries, quiz generation,    │
            │          flashcards, study plans, transcription,  │
            │          recommendations ──► Groq / Gemini APIs   │
            │                        │                          │
            ▼                        ▼                          ▼
  Cloud SQL Postgres 15 + pgvector         Memorystore Redis 7 (AUTH)
  system of record + document_chunks       cache, rate-limit counters,
  (ivfflat index)                          BullMQ queues
            ▲                                     ▲
            └──────── lms-worker (Cloud Run worker pool, always on) ──┘
                      same backend image, BullMQ consumers

  Cloud Storage: uploaded lecture material and assignment files
  Secret Manager: every credential · Cloud Monitoring: uptime checks + alert
```

## Request flow — AI tutor question (PRD §9.2)

1. The SPA posts the question to `backend` `/api/v1/ai/chat/sessions/:id/messages`.
2. The backend authenticates the user, applies the 20/min/user AI limit, and
   forwards to `ai-service` with `X-Internal-Token`, `X-User-Id` and the
   request's `X-Request-Id`.
3. `ai-service` embeds the question and runs a cosine search over
   `document_chunks` filtered by course.
4. The top chunks and the question, worded for the session's
   beginner/intermediate/advanced mode, go to the LLM (Groq, then Gemini).
5. The reply and its source lectures are stored in `ai_chat_messages` and
   returned; the backend queues a topic-mastery recompute.

## Background jobs (PRD §9.3)

All run on `lms-worker` through BullMQ. The API runs with
`DISABLE_INLINE_WORKER=1`, so request containers only serve HTTP.

| Queue | Trigger | Work |
|---|---|---|
| `ingestion` | lecture created with a transcript | chunk + embed for RAG (5 retries) |
| `transcription` | lecture created with a video | speech-to-text, then ingestion |
| `certificates` | course reaches 100 % | issue certificate, notify, email |
| `notifications` | announcements, replies, payments, certificates | SMTP email |
| `mastery` | quiz submit, lecture completion, AI chat | recompute per-topic mastery |
| `streaks` | cron 03:00 UTC | reset broken streaks |
| `recommendations` | cron 02:00 UTC | recompute every learner's suggestions |

## Caching (PRD §9.4)

| Data | Key | TTL | Invalidated by |
|---|---|---|---|
| Catalog listings | `catalog:*` | 5 min | any course, module, lecture or rating change, approval |
| Course detail (learner view) | `catalog:course:<id>` | 5 min | the same, plus quiz, assignment and resource changes |
| Leaderboards | `leaderboard:*` | 60 s | expiry |

Course owners and admins always read course detail live, because they also see
unreviewed AI quiz drafts.

## Security model

- JWT access tokens (15 min) and rotating refresh tokens (7 days), revoked on
  logout and on role change. Passwords hashed with bcrypt.
- Role checks in `requireRole()` middleware; ownership checks (instructor owns
  the course) in the service layer, per PRD §11.
- Emails stored as AES-256-GCM ciphertext with an HMAC blind index for lookup.
- `ai-service` rejects any `/api/v1/ai` call without the 64-character internal
  token.
- Cloud SQL reachable only through the Cloud SQL connector (plus the owner's IP
  for local development); Redis on a private IP with AUTH.

## Where the build differs from PRD §9 and §13

| PRD | Built | Why |
|---|---|---|
| NGINX API gateway | Google Front End (Cloud Run) + in-app rate limiting | Managed TLS and load balancing; no extra hop to run |
| Anthropic API | Groq + Gemini, Anthropic optional | Owner's choice: free tiers |
| AWS S3 / MinIO | Google Cloud Storage | Deployed on GCP |
| HLS through a CDN | Progressive MP4 from the source URL | No video is hosted on the platform yet; see the compliance report |
| Prometheus + Grafana | Cloud Monitoring uptime checks, Cloud Logging | Hosted option the PRD allows |
| Winston / structlog | Structured JSON loggers (backend, ai-service) | Same output, no dependency |
| Jest | Vitest | Same API, native TypeScript |
| Kubernetes, Terraform | Not used | Both optional in PRD §10 |
