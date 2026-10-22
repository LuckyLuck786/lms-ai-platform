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
- **No uptime or error alerting.** `/health` exists on both services but
  nothing polls it and no log-based alert is configured.
- **Backups are unverified.** Cloud SQL takes automated backups, but a restore
  has never been rehearsed.
