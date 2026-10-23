#!/usr/bin/env bash
# Tear down every billable Google Cloud resource this project created, so the
# project stops costing money once the platform is no longer needed.
#
# DESTRUCTIVE: deletes the database (all users, courses, submissions), Redis,
# both buckets (uploads and video) and every service. Take a backup first if
# you may want the data:  gcloud sql export sql lms-postgres gs://<bucket>/lms.sql --database=lms
#
#   scripts/teardown-gcp.sh            # prints what it would delete
#   scripts/teardown-gcp.sh --yes      # actually deletes
set -uo pipefail
P=transitviz-67dus; R=us-central1
run() { if [ "${1:-}" = "--yes" ]; then shift; echo "+ $*"; "$@" --quiet || true; else shift; echo "would run: $*"; fi; }
Y=${1:-}

for s in backend backend-staging ai-service ai-service-staging; do run "$Y" gcloud run services delete "$s" --region $R; done
for w in lms-worker lms-worker-staging; do run "$Y" gcloud run worker-pools delete "$w" --region $R; done
run "$Y" gcloud compute forwarding-rules delete lms-cdn-https --global
run "$Y" gcloud compute target-https-proxies delete lms-cdn-proxy
run "$Y" gcloud compute url-maps delete lms-cdn-map
run "$Y" gcloud compute backend-buckets delete lms-video-backend
run "$Y" gcloud compute ssl-certificates delete lms-cdn-cert --global
run "$Y" gcloud compute addresses delete lms-cdn-ip --global
run "$Y" gcloud redis instances delete lms-redis --region $R
run "$Y" gcloud compute instances delete lms-redis-vm --zone ${R}-a
run "$Y" gcloud sql instances delete lms-postgres
run "$Y" gcloud storage rm -r gs://lms-video-transitviz
run "$Y" gcloud storage rm -r gs://lms-media-transitviz
run "$Y" gcloud monitoring uptime delete lms-backend-health-ASik3jCxJfM
run "$Y" gcloud monitoring uptime delete lms-ai-service-health-jRrw-vme8mI
[ "$Y" = "--yes" ] || echo; echo "Vercel projects (free) are left alone: vercel project rm lms-ai-staging / lms-ai-frontend"
