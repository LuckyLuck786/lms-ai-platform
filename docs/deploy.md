# Deploying the full stack (Render + Neon + Upstash + Vercel)

The frontend is already live on Vercel (demo mode). This guide wires the
real API behind it. Four steps; only step 1–2 need dashboard clicks.

## 1. Provision the data services (free tiers)

| Service | Where | What to create | What to copy |
|---|---|---|---|
| **Neon** (Postgres + pgvector) | neon.tech — sign in with GitHub | A project, any region, free plan | **Pooled** connection string (ends `?sslmode=require`) |
| **Upstash** (Redis) | upstash.com — sign in with GitHub | A Redis database, free plan, closest region | **TCP** connection string (`rediss://default:...`) |

No credit card is required for either.

## 2. Import the Render blueprint

1. Render dashboard → **New + Blueprint** → connect the GitHub repo
   `LuckyLuck786/lms-ai-platform`.
2. Render reads [`render.yaml`](../render.yaml) and creates two free web
   services: `vertexon-api` (Node) and `vertexon-ai` (FastAPI). JWT secrets are
   generated automatically.
3. Paste into the prompted env vars:
   - `DATABASE_URL` (Neon pooled URL) → both services
   - `REDIS_URL` (Upstash TCP URL) → both services
   - `GROQ_API_KEY` + `GEMINI_API_KEY` → `vertexon-ai` only
   - `SMTP_URL` (optional) → `vertexon-api`

Both services build the Dockerfiles (backend runs `migrate && seed` on boot,
so the demo accounts and courses exist on the first start) and expose
`/health` for Render's health checks.

## 3. Point the frontend at the API

```bash
cd frontend
vercel env add VITE_API_BASE_URL production   # https://vertexon-api.onrender.com/api/v1
vercel deploy --prod --yes
```

The deployed site then calls the real API; demo mode turns itself off
automatically. `?demo=on` in the URL still forces the in-browser demo back on.

## 4. Ingest the seeded transcripts (RAG)

Seeded lectures have transcripts but no embeddings yet:

```bash
API=https://vertexon-api.onrender.com
for id in $(curl -s "$API/api/v1/..." ); do  # see script below
  curl -X POST https://vertexon-ai.onrender.com/api/v1/ai/internal/ingest \
    -H 'content-type: application/json' -d "{\"lecture_id\":\"$id\"}"
done
```

List lecture ids from Neon's SQL editor:

```sql
SELECT id FROM lectures WHERE transcript IS NOT NULL;
```

then loop them through `POST /api/v1/ai/internal/ingest` (Gemini embeddings).
After that, AI-tutor answers on the live site carry real citations.

## Operational notes

- **Free services spin down** after ~15 minutes without traffic; the first
  request after idle takes ~30–60 s to wake (`/health` wakes it).
- **Rollback** = redeploy the previous commit from the Render dashboard;
  every deploy records the git SHA.
- **Upstash free tier** is 10 000 commands/day. BullMQ's four workers idle on
  blocking pops (cheap), but if quota errors appear in the `vertexon-api`
  logs, either upgrade Upstash or swap `REDIS_URL` for a Render Key Value
  instance (free, 25 MB).
- **Local Docker stays valid**: nothing in the compose file changed; the
  cloud just injects env vars instead of reading `.env`.
