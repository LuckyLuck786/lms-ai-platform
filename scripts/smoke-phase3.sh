#!/usr/bin/env bash
# Phase 3 end-to-end smoke: ingestion, RAG chat with citations, summarize,
# AI quiz draft, flashcards, study plan, recommendations.
# Prereqs: data layer + migrated backend (port 4000) + ai-service (port 8000).
set -euo pipefail

API="${API:-http://localhost:4000/api/v1}"
SUFFIX="$(date +%s)"
INSTR_EMAIL="ai-instr-$SUFFIX@example.com"
STU_EMAIL="ai-stud-$SUFFIX@example.com"

field() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }
say() { printf '\n== %s ==\n' "$1"; }

say "setup: instructor + transcript lecture + approved + enrolled"
INSTR_TOK=$(curl -sf -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"full_name\":\"Rohit K\",\"email\":\"$INSTR_EMAIL\",\"password\":\"SecurePass123\",\"role\":\"instructor\"}" \
  | field "['access_token']")
STU_TOK=$(curl -sf -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"full_name\":\"Ananya S\",\"email\":\"$STU_EMAIL\",\"password\":\"SecurePass123\"}" \
  | field "['access_token']")

CID=$(curl -sf -X POST "$API/courses" -H "Authorization: Bearer $INSTR_TOK" -H 'Content-Type: application/json' \
  -d '{"title":"Algorithms Deep Dive","category":"Computer Science","difficulty":"intermediate"}' | field "['id']")
MID=$(curl -sf -X POST "$API/courses/$CID/modules" -H "Authorization: Bearer $INSTR_TOK" -H 'Content-Type: application/json' \
  -d '{"title":"Divide and Conquer"}' | field "['id']")
LID=$(curl -sf -X POST "$API/modules/$MID/lectures" -H "Authorization: Bearer $INSTR_TOK" -H 'Content-Type: application/json' \
  -d '{"title":"Quicksort Mechanics","duration_seconds":600,"transcript":"Quicksort picks a pivot element and partitions the array around it. On sorted input with the first element as pivot, partitioning is degenerate and the recursion depth reaches n, giving O(n^2) time. Choosing the median-of-three pivot or randomised pivot restores expected O(n log n). The partition scheme swaps elements greater than the pivot to the left boundary. Quicksort is not stable, but it is in-place and cache-friendly, which is why it dominates in practice. Mergesort is stable and guarantees O(n log n) but needs O(n) extra memory."}' | field "['id']")

docker exec lms-postgres psql -U lms -d lms -qc \
  "UPDATE user_roles SET role_id=(SELECT id FROM roles WHERE name='admin') WHERE user_id=(SELECT id FROM users WHERE email='$INSTR_EMAIL');" >/dev/null
ADMIN_TOK=$(curl -sf -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$INSTR_EMAIL\",\"password\":\"SecurePass123\"}" | field "['access_token']")
curl -sf -X POST "$API/courses/$CID/approve" -H "Authorization: Bearer $ADMIN_TOK" \
  -H 'Content-Type: application/json' -d '{"decision":"approved"}' >/dev/null
curl -sf -X POST "$API/courses/$CID/enroll" -H "Authorization: Bearer $STU_TOK" >/dev/null

say "ingestion: chunks + embeddings reach pgvector (poll up to 15s)"
CHUNKS=0
for i in $(seq 1 15); do
  CHUNKS=$(docker exec lms-postgres psql -U lms -d lms -tAc \
    "SELECT count(*) FROM document_chunks WHERE lecture_id='$LID'")
  [ "$CHUNKS" -gt 0 ] && break
  sleep 1
done
echo "chunks ingested: $CHUNKS"
[ "$CHUNKS" -gt 0 ] || { echo "ingestion failed"; exit 1; }

say "chat session + RAG reply with citations"
SID=$(curl -sf -X POST "$API/ai/chat/sessions" -H "Authorization: Bearer $STU_TOK" -H 'Content-Type: application/json' \
  -d "{\"course_id\":\"$CID\"}" | field "['id']")
REPLY=$(curl -sf -X POST "$API/ai/chat/sessions/$SID/messages" -H "Authorization: Bearer $STU_TOK" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Why does quicksort degrade on sorted input?"}')
echo "$REPLY" | field "['mode']"
echo "$REPLY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert 'reply' in d and len(d['reply']) > 40, d
assert d['sources'], 'no citations returned'
assert d['sources'][0]['lecture_id'], d['sources']
print('citations:', [s['lecture_title'] for s in d['sources']])"

say "mode switching changes explanation depth"
curl -sf -X PUT "$API/ai/chat/sessions/$SID/mode" -H "Authorization: Bearer $STU_TOK" \
  -H 'Content-Type: application/json' -d '{"mode":"beginner"}' | field "['mode']"
REPLY2=$(curl -sf -X POST "$API/ai/chat/sessions/$SID/messages" -H "Authorization: Bearer $STU_TOK" \
  -H 'Content-Type: application/json' -d '{"message":"Explain partitioning simply."}')
echo "$REPLY2" | field "['mode']"

say "lecture summarize (FR-A3)"
curl -sf -X POST "$API/ai/lectures/$LID/summarize" -H "Authorization: Bearer $STU_TOK" \
  | python3 -c "import sys,json; s=json.load(sys.stdin)['summary']; print(s[:100].replace(chr(10),' ')); assert len(s)>30"

say "AI quiz draft for instructor review (FR-A5)"
QUIZ=$(curl -sf -X POST "$API/ai/lectures/$LID/generate-quiz" -H "Authorization: Bearer $STU_TOK")
echo "$QUIZ" | field "['question_count']"
QID=$(echo "$QUIZ" | field "['quiz_id']")
curl -sf "$API/quizzes/$QID" -H "Authorization: Bearer $ADMIN_TOK" | field "['show_answers']"

say "flashcards for the module (FR-A7)"
curl -sf -X POST "$API/ai/modules/$MID/flashcards" -H "Authorization: Bearer $STU_TOK" \
  | field "['count']"

say "personalized study plan from quiz history (FR-A4)"
curl -sf -X POST "$API/ai/study-plan" -H "Authorization: Bearer $STU_TOK" -H 'Content-Type: application/json' \
  -d '{}' | python3 -c "import sys,json; p=json.load(sys.stdin)['plan']; print('plan items:', len(p['items']), '| weak:', p['weak_module_count'])"

say "recommendations (FR-S10)"
curl -sf "$API/ai/recommendations" -H "Authorization: Bearer $STU_TOK" \
  | python3 -c "import sys,json; items=json.load(sys.stdin)['items']; print('recs:', [(i['title'], i['score']) for i in items[:3]])"

say "chat history persisted"
curl -sf "$API/ai/chat/sessions/$SID/messages" -H "Authorization: Bearer $STU_TOK" \
  | field "['items'].__len__()"

printf '\nAll Phase 3 smoke checks passed.\n'
