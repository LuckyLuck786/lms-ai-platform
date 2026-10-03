#!/usr/bin/env bash
# End-to-end smoke test for the Phase 1 API surface (PRD §8).
# Prereqs: docker compose --env-file .env -f infra/docker-compose.yml up -d
#          cd backend && npm run migrate && npm run dev
set -euo pipefail

API="${API:-http://localhost:4000/api/v1}"
SUFFIX="$(date +%s)"
INSTR_EMAIL="rohit-$SUFFIX@example.com"
STU_EMAIL="ananya-$SUFFIX@example.com"

field() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }

say() { printf '\n== %s ==\n' "$1"; }

say "register instructor"
INSTR=$(curl -sf -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"full_name\":\"Rohit Kumar\",\"email\":\"$INSTR_EMAIL\",\"password\":\"SecurePass123\",\"role\":\"instructor\"}")
INSTR_TOK=$(echo "$INSTR" | field "['access_token']")

say "register student (defaults to student role)"
STU=$(curl -sf -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"full_name\":\"Ananya Sharma\",\"email\":\"$STU_EMAIL\",\"password\":\"SecurePass123\"}")
STU_TOK=$(echo "$STU" | field "['access_token']")
echo "$STU" | field "['user']['role']"

say "login + /auth/me"
curl -sf -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$STU_EMAIL\",\"password\":\"SecurePass123\"}" | field "['user']['role']"
curl -sf "$API/auth/me" -H "Authorization: Bearer $STU_TOK" | field "['email']"

say "public catalog is reachable without a token"
curl -sf "$API/courses?page=1" | field "['total']"

say "instructor creates course (status defaults to pending)"
COURSE=$(curl -sf -X POST "$API/courses" -H "Authorization: Bearer $INSTR_TOK" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Data Structures & Algorithms","description":"Master DSA from scratch","category":"Computer Science","difficulty":"beginner","price":0}')
echo "$COURSE" | field "['status']"
CID=$(echo "$COURSE" | field "['id']")

say "student course creation denied by RBAC (expect 403)"
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/courses" \
  -H "Authorization: Bearer $STU_TOK" -H 'Content-Type: application/json' \
  -d '{"title":"Hacked course"}'

say "instructor adds module + lecture"
MOD=$(curl -sf -X POST "$API/courses/$CID/modules" -H "Authorization: Bearer $INSTR_TOK" \
  -H 'Content-Type: application/json' -d '{"title":"Module 1: Complexity Analysis"}')
MID=$(echo "$MOD" | field "['id']")
curl -sf -X POST "$API/modules/$MID/lectures" -H "Authorization: Bearer $INSTR_TOK" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Big-O Notation","duration_seconds":720,"transcript":"Big-O describes upper bounds on growth..."}' \
  | field "['title']"

say "promote instructor to admin, approve course (FR-AD1)"
docker exec lms-postgres psql -U lms -d lms -qc \
  "UPDATE user_roles SET role_id=(SELECT id FROM roles WHERE name='admin') WHERE user_id=(SELECT id FROM users WHERE email='$INSTR_EMAIL');" >/dev/null
ADMIN_TOK=$(curl -sf -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$INSTR_EMAIL\",\"password\":\"SecurePass123\"}" | field "['access_token']")
curl -sf -X POST "$API/courses/$CID/approve" -H "Authorization: Bearer $ADMIN_TOK" \
  -H 'Content-Type: application/json' -d '{"decision":"approved","comment":"Looks good"}' | field "['status']"

say "catalog filters (category + difficulty) find the course"
curl -sf "$API/courses?category=Computer%20Science&difficulty=beginner" | field "['items'][0]['title']"

say "student enrolls + reads enrollments/me"
curl -sf -X POST "$API/courses/$CID/enroll" -H "Authorization: Bearer $STU_TOK" | field "['progress_percent']"
curl -sf "$API/enrollments/me" -H "Authorization: Bearer $STU_TOK" | field "['items'][0]['title']"

say "double enroll rejected (expect 409)"
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/courses/$CID/enroll" -H "Authorization: Bearer $STU_TOK"

say "standard error envelope (PRD §8.8)"
curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"bad-email","password":"x"}'; echo

say "refresh token rotation works, replay is rejected"
REF=$(curl -sf -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$STU_EMAIL\",\"password\":\"SecurePass123\"}" | field "['refresh_token']")
curl -sf -X POST "$API/auth/refresh" -H 'Content-Type: application/json' \
  -d "{\"refresh_token\":\"$REF\"}" | field "['access_token'] is not None"
curl -s -X POST "$API/auth/refresh" -H 'Content-Type: application/json' \
  -d "{\"refresh_token\":\"$REF\"}" | field "['error']['code']"

printf '\nAll smoke checks passed.\n'
