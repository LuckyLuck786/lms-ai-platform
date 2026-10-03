#!/usr/bin/env bash
# Phase 4 end-to-end smoke: admin analytics/users/approvals/moderation,
# discussion forum with flagging, announcements + notifications.
# Prereqs: data layer + migrated backend running on :4000.
set -euo pipefail

API="${API:-http://localhost:4000/api/v1}"
SUFFIX="$(date +%s)"
INSTR_EMAIL="p4-instr-$SUFFIX@example.com"
STU_EMAIL="p4-stud-$SUFFIX@example.com"

field() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }
say() { printf '\n== %s ==\n' "$1"; }

say "setup: instructor + student + approved course"
INSTR_TOK=$(curl -sf -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"full_name\":\"Rohit K\",\"email\":\"$INSTR_EMAIL\",\"password\":\"SecurePass123\",\"role\":\"instructor\"}" \
  | field "['access_token']")
STU_TOK=$(curl -sf -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"full_name\":\"Ananya S\",\"email\":\"$STU_EMAIL\",\"password\":\"SecurePass123\"}" \
  | field "['access_token']")

CID=$(curl -sf -X POST "$API/courses" -H "Authorization: Bearer $INSTR_TOK" -H 'Content-Type: application/json' \
  -d '{"title":"Platform Governance 101","category":"Business","difficulty":"beginner"}' | field "['id']")
MID=$(curl -sf -X POST "$API/courses/$CID/modules" -H "Authorization: Bearer $INSTR_TOK" -H 'Content-Type: application/json' \
  -d '{"title":"Basics"}' | field "['id']")

docker exec lms-postgres psql -U lms -d lms -qc \
  "UPDATE user_roles SET role_id=(SELECT id FROM roles WHERE name='admin') WHERE user_id=(SELECT id FROM users WHERE email='$INSTR_EMAIL');" >/dev/null
ADMIN_TOK=$(curl -sf -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$INSTR_EMAIL\",\"password\":\"SecurePass123\"}" | field "['access_token']")

say "approval queue shows the pending course (FR-AD1)"
PENDING=$(curl -sf "$API/admin/courses/pending" -H "Authorization: Bearer $ADMIN_TOK")
echo "$PENDING" | python3 -c "
import sys, json
items = json.load(sys.stdin)['items']
assert any(i['id'] == '$CID' for i in items), 'course not in queue'
print('in queue:', len(items))"
curl -sf -X POST "$API/courses/$CID/approve" -H "Authorization: Bearer $ADMIN_TOK" \
  -H 'Content-Type: application/json' -d '{"decision":"approved","comment":"demo"}' | field "['status']"
curl -sf -X POST "$API/courses/$CID/enroll" -H "Authorization: Bearer $STU_TOK" >/dev/null

say "announcements fan out to enrolled students (FR-I6)"
ANN=$(curl -sf -X POST "$API/courses/$CID/announcements" -H "Authorization: Bearer $ADMIN_TOK" \
  -H 'Content-Type: application/json' -d '{"content":"Midterm opens Monday at 9 AM."}')
echo "$ANN" | field "['notified']"
curl -sf "$API/courses/$CID/announcements" -H "Authorization: Bearer $STU_TOK" | field "['items'][0]['content']"

say "in-app notifications arrive + mark read"
NOTIFS=$(curl -sf "$API/users/me/notifications" -H "Authorization: Bearer $STU_TOK")
echo "$NOTIFS" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d['unread'] >= 1, d
print('unread:', d['unread'], '| first:', d['items'][0]['title'])"
NID=$(echo "$NOTIFS" | field "['items'][0]['id']")
curl -sf -X PUT "$API/notifications/$NID/read" -H "Authorization: Bearer $STU_TOK" >/dev/null
curl -sf "$API/users/me/notifications" -H "Authorization: Bearer $STU_TOK" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('after mark-read unread:', d['unread'])"

say "forum: thread, reply, flag"
TID=$(curl -sf -X POST "$API/courses/$CID/threads" -H "Authorization: Bearer $STU_TOK" -H 'Content-Type: application/json' \
  -d '{"title":"Midterm scope questions?"}' | field "['id']")
P1=$(curl -sf -X POST "$API/threads/$TID/posts" -H "Authorization: Bearer $STU_TOK" -H 'Content-Type: application/json' \
  -d '{"content":"Does the midterm cover module 2?"}' | field "['id']")
curl -sf -X POST "$API/threads/$TID/posts" -H "Authorization: Bearer $ADMIN_TOK" -H 'Content-Type: application/json' \
  -d '{"content":"Yes — modules 1 and 2."}' >/dev/null
curl -sf "$API/threads/$TID/posts" -H "Authorization: Bearer $STU_TOK" | field "['items'].__len__()"
curl -sf -X POST "$API/posts/$P1/flag" -H "Authorization: Bearer $ADMIN_TOK" | field "['is_flagged']"

say "flagged posts surface in admin moderation (FR-AD5)"
curl -sf "$API/admin/moderation/flagged-posts" -H "Authorization: Bearer $ADMIN_TOK" \
  | python3 -c "
import sys, json
items = json.load(sys.stdin)['items']
assert any(i['id'] == '$P1' for i in items), 'flag missing'
print('flagged visible:', len(items))"
curl -sf -X DELETE "$API/admin/moderation/posts/$P1" -H "Authorization: Bearer $ADMIN_TOK" >/dev/null
echo "post removed"

say "user management: search, role change, suspend (FR-AD2/AD4)"
curl -sf "$API/admin/users?q=$STU_EMAIL" -H "Authorization: Bearer $ADMIN_TOK" | field "['items'][0]['email']"
STU_ID=$(curl -sf "$API/admin/users?q=$STU_EMAIL" -H "Authorization: Bearer $ADMIN_TOK" | field "['items'][0]['id']")
curl -sf -X PUT "$API/admin/users/$STU_ID/role" -H "Authorization: Bearer $ADMIN_TOK" \
  -H 'Content-Type: application/json' -d '{"role":"instructor"}' | field "['roles']"
curl -sf -X PUT "$API/admin/users/$STU_ID/suspend" -H "Authorization: Bearer $ADMIN_TOK" \
  -H 'Content-Type: application/json' -d '{"is_active":false}' | field "['is_active']"
echo "-- suspended login rejected:"
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$STU_EMAIL\",\"password\":\"SecurePass123\"}"
curl -sf -X PUT "$API/admin/users/$STU_ID/role" -H "Authorization: Bearer $ADMIN_TOK" \
  -H 'Content-Type: application/json' -d '{"role":"student"}' >/dev/null
curl -sf -X PUT "$API/admin/users/$STU_ID/suspend" -H "Authorization: Bearer $ADMIN_TOK" \
  -H 'Content-Type: application/json' -d '{"is_active":true}' >/dev/null

say "analytics overview (FR-AD3)"
curl -sf "$API/admin/analytics/overview" -H "Authorization: Bearer $ADMIN_TOK" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for k in ['dau','total_users','total_enrollments','completion_rate','revenue','pending_courses','flagged_posts']:
    assert k in d, k
print({k: d[k] for k in ['dau','total_users','total_enrollments','completion_rate','total_courses']})"

say "non-admin blocked from admin routes (RBAC)"
curl -s -o /dev/null -w "%{http_code}\n" "$API/admin/users" -H "Authorization: Bearer $STU_TOK"

printf '\nAll Phase 4 smoke checks passed.\n'
