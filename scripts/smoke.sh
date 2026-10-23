#!/usr/bin/env bash
# Post-deploy smoke test: health of both services and a real catalog read.
#   scripts/smoke.sh <backend-service> <ai-service>
set -euo pipefail
REGION=${REGION:-us-central1}
for svc in "$1" "$2"; do
  url=$(gcloud run services describe "$svc" --region "$REGION" --format='value(status.url)')
  for i in 1 2 3 4 5; do
    curl -sf "$url/health" >/dev/null && break
    [ "$i" = 5 ] && { echo "::error::$svc health check failed"; exit 1; }
    sleep 5
  done
  echo "$svc healthy at $url"
done
api=$(gcloud run services describe "$1" --region "$REGION" --format='value(status.url)')
curl -sf "$api/api/v1/courses?limit=1" >/dev/null
echo "catalog OK"
