# Deploying to Google Cloud Run (current production path)

This is the stack production runs:

| Layer | Service |
|---|---|
| Backend API (Express) | Cloud Run service |
| AI service (FastAPI) | Cloud Run service |
| Postgres 15 + pgvector | Cloud SQL |
| Redis (cache + BullMQ queues) | Memorystore |
| Uploaded media | Cloud Storage bucket (`GCS_BUCKET`) |
| Frontend SPA | Vercel |

> **Placeholders.** Values that differ per project are written as
> `<PROJECT_ID>`, `<REGION>`, `<SQL_INSTANCE>`, `<REDIS_HOST>`, `<BUCKET>`.
> Substitute your own; nothing here is secret except the values you set with
> `--set-secrets`.

---

## 0. Current topology (as deployed, 24 October 2026)

The generic steps below use placeholders. This is what is actually running in
project `transitviz-67dus`, region `us-central1`:

| Component | Resource | Notes |
|---|---|---|
| Backend API | Cloud Run service `backend` | `DISABLE_INLINE_WORKER=1` — serves HTTP only |
| Background jobs | Cloud Run **worker pool** `lms-worker` | Same backend image, `node dist/jobs/worker-main.js`, 1 always-on instance. Runs certificates, email, mastery, transcription, streak cron (03:00 UTC) and recommendation cron (02:00 UTC) |
| AI service | Cloud Run service `ai-service` | Public ingress; every `/api/v1/ai` route requires `X-Internal-Token` (see note) |
| Postgres 15 + pgvector | Cloud SQL `lms-postgres` | Reached through the Cloud SQL connector socket. Authorized networks: the owner's IP only, for local development |
| Redis | Memorystore `lms-redis` (Basic, 1 GB) | AUTH enabled, `maxmemory-policy=noeviction` (BullMQ requirement). Private IP, reached by Direct VPC egress |
| Network | Direct VPC egress, network/subnet `default`, `private-ranges-only` | All three Cloud Run workloads |
| Media | GCS bucket `lms-media-transitviz` | |
| Images | Artifact Registry `lms-docker` | Tagged with the short git SHA |
| Email | Gmail SMTP (`smtp.gmail.com:465`, app password) | Google Cloud has no email-sending product; ports 465/587 are open from Cloud Run |
| Monitoring | Uptime checks `lms-backend-health`, `lms-ai-service-health` (5 min) + alert policy "LMS-AI service down" | Emails the owner |
| Budget | "LMS-AI monthly", ₹6,000, alerts at 50/90/100 % | Measured before credits |
| Video CDN | Global HTTPS load balancer `lms-cdn-https` → backend bucket `lms-video-backend` (Cloud CDN) → bucket `lms-video-transitviz` | Host `cdn-34-49-229-91.sslip.io`, Google-managed certificate `lms-cdn-cert`. Bucket is public-read and holds only transcoded lecture video |
| Transcoding | Transcoder API, `preset/web-hd`; video-only ladder for silent sources | Worker queue `video`; `POST /admin/videos/backfill` re-queues lectures that were never processed |
| Staging | `backend-staging`, `ai-service-staging`, worker pool `lms-worker-staging`, database `lms_staging` (same instance), Redis DB 1, Vercel project `lms-ai-staging` | Secrets suffixed `-staging`; SMTP and LLM keys shared |
| Backups | Daily automated (20:30 UTC), 7 retained, point-in-time recovery | Cloud SQL |
| CI/CD | `.github/workflows/deploy.yml` after green CI on `main` | Service account `github-deployer` via Workload Identity pool `github` — no keys; accepts only `LuckyLuck786/lms-ai-platform` on `refs/heads/main` |

Both Cloud Run URL forms resolve to the same service and are interchangeable:
`backend-381741146904.us-central1.run.app` and `backend-mqkhx6y4xq-uc.a.run.app`.

**Secrets** (Secret Manager, mounted with `--set-secrets` / `--update-secrets`):
`database-url`, `redis-url`, `jwt-secret`, `jwt-refresh-secret`,
`internal-api-token`, `smtp-url`, `groq-api-key`, `gemini-api-key`,
`pii-encryption-key`, `pii-hash-key`. No secret is
set as a plain environment variable.

**Why the AI service keeps public ingress.** Section 4 below describes
`--no-allow-unauthenticated`, which would require the backend to mint Google
identity tokens — code it does not have. `--ingress internal` would instead
need all backend egress through the VPC plus Cloud NAT for SMTP. The deployed
choice is public ingress with a mandatory 64-character `X-Internal-Token`,
compared in constant time. An unauthenticated call returns 401.

**PII keys.** `pii-encryption-key` decrypts every stored email and
`pii-hash-key` finds users by email. Destroying or rotating either without a
re-encryption pass locks every user out. Never delete them.

**Release flow.** Pushing to `main` deploys to **staging** once CI passes.
Tagging a release promotes the same images to **production**:

```bash
git tag -a v1.0.1 -m "..." && git push origin v1.0.1
```

The frontend is deployed with the Vercel CLI, because the Vercel projects
are not linked to Git:

```bash
cd frontend && vercel --prod                     # production (lms-ai-frontend)
# staging: a copy of frontend/ linked to the lms-ai-staging project
vercel link --project lms-ai-staging && vercel --prod
```

Images can also be built and deployed by hand:

```bash
SHA=$(git rev-parse --short HEAD)
IMG=us-central1-docker.pkg.dev/transitviz-67dus/lms-docker
gcloud builds submit backend    --tag "$IMG/backend:$SHA"
gcloud builds submit ai-service --tag "$IMG/ai-service:$SHA"
gcloud run deploy ai-service --image "$IMG/ai-service:$SHA" --region us-central1
gcloud run deploy backend    --image "$IMG/backend:$SHA"    --region us-central1
gcloud run worker-pools deploy lms-worker --image "$IMG/backend:$SHA" --region us-central1
```

Flags, secrets and networking persist on the services, so an image-only deploy
keeps them.

**Load-test baseline (NFR §6).** `infra/load/k6-core.js` against a
no-traffic tagged revision with the general rate limit lifted, 100 virtual
users for 60 s from Bangalore: 12,367 requests, 0 failures. Client-side p95
was 315 ms, of which ~250 ms is round-trip to `us-central1` (the fastest
request took 253 ms). Server-side p95 from the request logs was **11.9 ms**
(p99 27.6 ms). The target is met by the API; the remaining latency is
geography, which a region nearer the users (`asia-south1`) would remove.

---

## 1. One-time infrastructure

```bash
PROJECT=<PROJECT_ID>
REGION=<REGION>

gcloud config set project "$PROJECT"
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  redis.googleapis.com storage.googleapis.com secretmanager.googleapis.com \
  vpcaccess.googleapis.com artifactregistry.googleapis.com

# Postgres 15 with pgvector (the migrations create the extension).
gcloud sql instances create <SQL_INSTANCE> \
  --database-version=POSTGRES_15 --region="$REGION" --tier=db-f1-micro
gcloud sql databases create lms --instance=<SQL_INSTANCE>
gcloud sql users set-password postgres --instance=<SQL_INSTANCE> --password='<DB_PASSWORD>'

# Media bucket — this is GCS_BUCKET. The runtime service account reads/writes it.
gcloud storage buckets create gs://<BUCKET> --location="$REGION" --uniform-bucket-level-access
```

Grant the Cloud Run runtime service account `roles/storage.objectAdmin` on the
bucket (object read + write), and `roles/cloudsql.client` for the database.

## 2. Secrets (never inline environment variables)

Everything sensitive goes to Secret Manager, so it never appears in a service
description, a build log, or a shell history file:

```bash
printf '%s' "$(openssl rand -base64 48)" | gcloud secrets create jwt-secret --data-file=-
printf '%s' "$(openssl rand -base64 48)" | gcloud secrets create jwt-refresh-secret --data-file=-
printf '%s' "$(openssl rand -base64 48)" | gcloud secrets create internal-api-token --data-file=-
printf '%s' '<db-password>' | gcloud secrets create db-password --data-file=-
# Only if payments are enabled:
printf '%s' '<rzp-key-id>'      | gcloud secrets create razorpay-key-id --data-file=-
printf '%s' '<rzp-key-secret>'  | gcloud secrets create razorpay-key-secret --data-file=-
printf '%s' '<rzp-webhook-secret>' | gcloud secrets create razorpay-webhook-secret --data-file=-
```

Give the runtime service account `roles/secretmanager.secretAccessor` on each.

## 3. Database URL and Redis

The backend reaches Cloud SQL through the serverless VPC connector when Redis
is on Memorystore (Memorystore has no public endpoint), which is why the
connector is required rather than optional here:

```bash
DATABASE_URL="postgresql://postgres:<DB_PASSWORD>@/lms?host=/cloudsql/$PROJECT:$REGION:<SQL_INSTANCE>"
REDIS_URL="redis://<REDIS_HOST>:6379"
```

Two hardening rules that the compliance audit flagged as open, and which this
guide closes by construction:

- Cloud SQL must **not** be exposed to `0.0.0.0/0`. Attach it to the VPC
  connector and leave its authorized networks empty.
- Memorystore's AUTH string must be enabled, and `REDIS_URL` must carry it
  (`redis://:<AUTH>@<REDIS_HOST>:6379`). A queue Redis without AUTH is
  writable by anything that can reach the VPC.

## 4. Build and deploy the two services

```bash
gcloud artifacts repositories create lms --repository-format=docker --location="$REGION"

# Backend — migrations run on boot before the server starts.
gcloud builds submit backend --tag "$REGION-docker.pkg.dev/$PROJECT/lms/backend:$(git rev-parse --short HEAD)"

gcloud run deploy backend \
  --image "$REGION-docker.pkg.dev/$PROJECT/lms/backend:<SHA>" \
  --region "$REGION" --allow-unauthenticated \
  --add-cloudsql-instances "$PROJECT:$REGION:<SQL_INSTANCE>" \
  --vpc-connector <CONNECTOR> \
  --set-env-vars "NODE_ENV=production,GCS_BUCKET=<BUCKET>,AI_SERVICE_URL=<AI_SERVICE_URL>,CORS_ORIGIN=<FRONTEND_URL>,APP_URL=<FRONTEND_URL>" \
  --set-secrets "DATABASE_URL=db-password:latest,JWT_SECRET=jwt-secret:latest,JWT_REFRESH_SECRET=jwt-refresh-secret:latest,INTERNAL_API_TOKEN=internal-api-token:latest"
```

The AI service is deployed **without** public ingress, because the backend is
its only caller. That makes `X-Internal-Token` the inner guard and IAM the
outer one:

```bash
gcloud run deploy ai-service \
  --image "$REGION-docker.pkg.dev/$PROJECT/lms/ai-service:<SHA>" \
  --region "$REGION" --no-allow-unauthenticated \
  --add-cloudsql-instances "$PROJECT:$REGION:<SQL_INSTANCE>" \
  --vpc-connector <CONNECTOR> \
  --set-env-vars "DATABASE_URL=...,REDIS_URL=..." \
  --set-secrets "INTERNAL_API_TOKEN=internal-api-token:latest,GROQ_API_KEY=groq-key:latest"
```

> `DATABASE_URL` contains the DB password, so it belongs in `--set-secrets`
> rather than `--set-env-vars`. Split the password into its own secret and
> compose the URL at runtime if you want the whole string in Secret Manager.
> Note the AI service reads `INTERNAL_API_TOKEN` from its own environment.

## 5. Post-deploy checks

Run these against the *deployed* origin, not localhost:

```bash
API=<BACKEND_URL>

curl -sf "$API/health"                       # {"status":"ok",...}
curl -s  "$API/"                             # landing JSON, not a 404

TOKEN=$(curl -s -X POST "$API/api/v1/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"student@vertexon.demo","password":"<DEMO_PASSWORD>"}' | jq -r .access_token)

curl -sf "$API/api/v1/courses"                                   # public catalog
curl -sf -H "authorization: Bearer $TOKEN" "$API/api/v1/enrollments/me"
curl -sf -H "authorization: Bearer $TOKEN" "$API/api/v1/ai/recommendations"
```

Then confirm the two things that are easy to get wrong:

1. **The AI service is genuinely private.**
   `curl -s -o /dev/null -w '%{http_code}' <AI_SERVICE_URL>/health` must be
   `403` from outside, while the backend's AI routes still answer 200.
2. **Uploaded media survives a redeploy.** Upload a lecture resource, note the
   `/uploads/...` URL, redeploy the backend, and fetch that URL again — with
   `GCS_BUCKET` set it must still return the file.

## 6. RAG ingestion after deploy

Transcripts are chunked and embedded into pgvector, which the AI tutor's
citations depend on:

```bash
curl -X POST "$AI_SERVICE_URL/api/v1/ai/internal/ingest" \
  -H "x-internal-token: $INTERNAL_API_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"lecture_id":"<LECTURE_UUID>"}'
```

Called from outside the VPC this needs an identity token as well, because the
service is `--no-allow-unauthenticated`. From the backend this happens
automatically whenever a lecture with a transcript is created.

## 7. Frontend

Vercel builds `frontend/` with `VITE_API_BASE_URL` pointing at the backend's
`/api/v1`. Leaving it blank switches the SPA into demo mode, which is a
supported configuration — the app then answers every call from the in-browser
backend and needs no server at all.

## 8. Known gaps in this setup

- **No IaC.** Everything above is imperative; there is no Terraform/Pulumi
  definition, so the environment cannot be reproduced or diffed.
- ~~**No uptime or error alerting.**~~ Closed 23 Oct 2026 — uptime checks on
  both `/health` endpoints with an email alert policy (§0). Error-rate alerting
  on 5xx responses is still not configured.
- ~~**Rate limits are per instance.**~~ Closed — Redis-backed store.
- ~~**Backups are unverified.**~~ Closed 23 Oct 2026 — point-in-time clone
  `lms-restore-drill` restored from 10 minutes earlier matched production row
  for row (7 users, 4 courses, 2 enrolments, 8 RAG chunks, 15 migrations),
  then was deleted. Repeat with
  `gcloud sql instances clone lms-postgres <name> --point-in-time <UTC time>`.
