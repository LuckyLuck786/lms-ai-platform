#!/usr/bin/env python3
"""Walk every PRD v1.0 functional requirement end to end against a running stack.

    python3 scripts/verify_prd.py http://localhost:4000/api/v1

It creates a course, users, submissions and quiz attempts, so point it at a
local or CI stack seeded with `npm run seed` — never production. Exits non-zero
if any requirement fails. Standard library only.
"""

import io
import json
import sys
import time
import uuid
import urllib.error
import urllib.request

API = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:4000/api/v1"
PASSWORD = "DemoPass123!"
results: list[tuple[str, bool, str]] = []
_ip = [0]


def call(method, path, token=None, body=None, files=None, raw=False):
    """One HTTP call. Each gets its own X-Forwarded-For so the 10/min auth
    limit (itself verified below) does not throttle the walkthrough."""
    _ip[0] += 1
    headers = {"x-forwarded-for": f"198.18.{_ip[0] // 250}.{_ip[0] % 250 + 1}"}
    data = None
    if token:
        headers["authorization"] = f"Bearer {token}"
    if files:
        boundary = uuid.uuid4().hex
        buf = io.BytesIO()
        for k, v in (body or {}).items():
            buf.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        for k, (name, content, ctype) in files.items():
            buf.write(
                f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"; filename="{name}"\r\n'
                f"Content-Type: {ctype}\r\n\r\n".encode()
            )
            buf.write(content + b"\r\n")
        buf.write(f"--{boundary}--\r\n".encode())
        data = buf.getvalue()
        headers["content-type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["content-type"] = "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            payload = r.read()
            return r.status, (payload if raw else _json(payload)), dict(r.headers)
    except urllib.error.HTTPError as e:
        payload = e.read()
        return e.code, (payload if raw else _json(payload)), dict(e.headers)


def _json(b):
    try:
        return json.loads(b or b"{}")
    except ValueError:
        return {"_raw": b[:200].decode(errors="replace")}


def check(fr, ok, detail=""):
    results.append((fr, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {fr:8} {detail}")


def login(email, password=PASSWORD):
    s, b, _ = call("POST", "/auth/login", body={"email": email, "password": password})
    return b.get("access_token") if s == 200 else None


admin = login("admin@vertexon.demo")
instructor = login("instructor@vertexon.demo")
assert admin and instructor, "seeded demo accounts missing — run npm run seed"
tag = uuid.uuid4().hex[:6]

# ---------------------------------------------------------------- Auth (S1)
email = f"verify-{tag}@example.com"
s, b, _ = call("POST", "/auth/register", body={"full_name": "Verify Learner", "email": email, "password": PASSWORD})
student = login(email)
s2, me, _ = call("GET", "/auth/me", student)
check("FR-S1", s == 201 and student and me.get("email") == email, "register → login → /auth/me")

# ------------------------------------------------- Instructor authoring (I1–I4)
s, course, _ = call("POST", "/courses", instructor, {
    "title": f"Verification Course {tag}", "description": "Sorting algorithms and their complexity.",
    "category": "Computer Science", "difficulty": "beginner", "price": 0,
    "thumbnail_url": "https://example.com/thumb.png"})
cid = course.get("id")
check("FR-I1", s == 201 and course.get("status") == "pending", f"course created as {course.get('status')}")

s, mod, _ = call("POST", f"/courses/{cid}/modules", instructor, {"title": "Sorting", "order_index": 0})
mid = mod.get("id")
transcript = ("Quicksort picks a pivot and partitions the array. When the pivot is always the first "
              "element and the input is already sorted, every partition is maximally unbalanced, so "
              "quicksort degrades to O(n^2). Choosing a random pivot or median-of-three avoids this. "
              "Merge sort always runs in O(n log n) but needs O(n) extra memory.") * 2
lectures = []
for i, title in enumerate(["Quicksort", "Merge sort"]):
    s, lec, _ = call("POST", f"/modules/{mid}/lectures", instructor, {
        "title": title, "transcript": transcript, "duration_seconds": 600, "order_index": i,
        "video_url": "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4"})
    lectures.append(lec.get("id"))
s, res, _ = call("POST", f"/lectures/{lectures[0]}/resources", instructor, files={
    "resources": ("slides.pdf", b"%PDF-1.4\n%verify\n", "application/pdf")})
check("FR-I2", all(lectures) and s in (200, 201), f"module + 2 lectures + PDF resource (resource {s})")

due = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 86400))
s, asg, _ = call("POST", "/assignments", instructor, {
    "course_id": cid, "title": "Implement quicksort", "instructions": "Submit code.",
    "rubric": [{"criterion": "Correctness", "weight": 70}, {"criterion": "Style", "weight": 30}], "due_date": due})
past = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 3600))
_, asg_past, _ = call("POST", "/assignments", instructor, {"course_id": cid, "title": "Closed one", "due_date": past})
check("FR-I3", s == 201 and asg.get("rubric"), "assignment with rubric + deadline")

s, quiz, _ = call("POST", "/quizzes", instructor, {"module_id": mid, "title": "Sorting check", "questions": [
    {"question_text": "Worst case of naive quicksort?", "question_type": "mcq", "options": [
        {"option_text": "O(n^2)", "is_correct": True}, {"option_text": "O(n)", "is_correct": False}]},
    {"question_text": "Which are O(n log n) worst case?", "question_type": "multi_select", "options": [
        {"option_text": "Merge sort", "is_correct": True}, {"option_text": "Heap sort", "is_correct": True},
        {"option_text": "Bubble sort", "is_correct": False}]},
    {"question_text": "Name the element quicksort partitions around.", "question_type": "short_answer", "options": [
        {"option_text": "pivot", "is_correct": True}, {"option_text": "-", "is_correct": False}]}]})
qid = quiz.get("id")
check("FR-I4", s == 201 and qid, "manual quiz with MCQ, multi-select, short answer")

# ------------------------------------------------------- Admin approval (AD1)
s, pending, _ = call("GET", "/admin/courses/pending", admin)
in_queue = any(c.get("id") == cid for c in pending.get("items", []))
s2, _, _ = call("POST", f"/courses/{cid}/approve", admin, {"decision": "approved"})
_, cat, _ = call("GET", f"/courses?q=Verification%20Course%20{tag}")
check("FR-AD1", in_queue and s2 == 200 and cat.get("total") == 1, "pending queue → approve → publicly listed")

# --------------------------------------------------------- Catalog (S3)
_, f1, _ = call("GET", "/courses?category=Computer%20Science&difficulty=beginner")
_, f2, _ = call("GET", "/courses?minRating=5")
ok = any(c["id"] == cid for c in f1.get("items", [])) and all(
    float(c.get("avg_rating") or 0) >= 5 for c in f2.get("items", []))
check("FR-S3", ok, "category + difficulty + rating filters + search")

# ------------------------------------------------- Learning loop (S4–S8)
s, _, _ = call("POST", f"/courses/{cid}/enroll", student)
check("enrol", s == 201, "free course enrolment")
call("POST", f"/lectures/{lectures[0]}/progress", student, {"watched_seconds": 42})
_, prog, _ = call("GET", f"/lectures/{lectures[0]}/progress", student)
check("FR-S4", prog.get("watched_seconds") == 42, f"resume position stored ({prog.get('watched_seconds')}s)")

s1, _, _ = call("POST", f"/lectures/{lectures[0]}/notes", student, {"timestamp_seconds": 30, "content": "pivot!"})
s2, _, _ = call("POST", f"/lectures/{lectures[0]}/bookmarks", student, {"timestamp_seconds": 61})
_, notes, _ = call("GET", f"/lectures/{lectures[0]}/notes", student)
check("FR-S5", s1 == 201 and s2 == 201 and notes.get("items", [{}])[0].get("timestamp_seconds") == 30,
      "timestamped note + bookmark")

s1, sub, _ = call("POST", f"/assignments/{asg['id']}/submit", student, files={
    "file": ("quicksort.zip", b"PK\x03\x04verify", "application/zip")})
s2, _, _ = call("POST", f"/assignments/{asg_past['id']}/submit", student, files={
    "file": ("late.pdf", b"%PDF-1.4", "application/pdf")})
s3, _, _ = call("POST", f"/assignments/{asg['id']}/submit", student, files={
    "file": ("virus.exe", b"MZ", "application/x-msdownload")})
check("FR-S6", s1 == 201 and s2 >= 400 and s3 >= 400, f"ZIP accepted {s1}; late {s2}; .exe {s3}")

s, graded, _ = call("PUT", f"/submissions/{sub.get('id')}/grade", instructor, {"grade": 88, "feedback": "Good"})
check("grade", s == 200 and float(graded.get("grade", 0)) == 88, "instructor grades submission")

_, qd, _ = call("GET", f"/quizzes/{qid}", student)
s, att, _ = call("POST", f"/quizzes/{qid}/attempt", student, {})
answers = []
for q in qd.get("questions", []):
    opts = q.get("options", [])
    if q["question_type"] == "mcq":
        answers.append({"question_id": q["id"], "selected_option_ids": [o["id"] for o in opts if o["option_text"] == "O(n^2)"]})
    elif q["question_type"] == "multi_select":
        answers.append({"question_id": q["id"], "selected_option_ids": [o["id"] for o in opts if "sort" in o["option_text"] and "Bubble" not in o["option_text"]]})
    else:
        answers.append({"question_id": q["id"], "text_answer": "Pivot"})
s, scored, _ = call("POST", f"/attempts/{att.get('id')}/submit", student, {"answers": answers})
check("FR-S7", s == 200 and float(scored.get("score", -1)) == 100, f"auto-graded score {scored.get('score')}")

for lid in lectures:
    call("POST", f"/lectures/{lid}/progress", student, {"watched_seconds": 600, "completed": True})
cert = None
for _ in range(20):
    _, certs, _ = call("GET", "/users/me/certificates", student)
    cert = next((c for c in certs.get("items", [])
                 if c.get("course_title") == f"Verification Course {tag}" and c.get("certificate_url")), None)
    if cert:
        break
    time.sleep(1.5)
pdf_ok = False
if cert:
    s, pdf, hdr = call("GET", f"/certificates/{cert['id']}/download", student, raw=True)
    pdf_ok = s == 200 and pdf[:4] == b"%PDF" and cert["certificate_url"].startswith("/api/v1/certificates/")
check("FR-S8", pdf_ok, f"certificate issued on 100% completion, PDF downloads, url={cert and cert['certificate_url']}")

_, badges, _ = call("GET", "/users/me/badges", student)
names = [b.get("name", "") for b in badges.get("items", badges if isinstance(badges, list) else [])]
check("FR-S9", len(names) >= 1, f"badges: {', '.join(names) or 'none'}")

_, enr, _ = call("GET", "/enrollments/me", student)
_, streak, _ = call("GET", "/users/me/streak", student)
mine = next((e for e in enr.get("items", []) if (e.get("course_id") or e.get("id")) == cid), {})
check("FR-S2", float(mine.get("progress_percent", 0)) == 100 and "current_streak" in streak,
      f"dashboard progress {mine.get('progress_percent')}%, streak {streak.get('current_streak')}")

# ------------------------------------------------------------ AI tutor (A1–A8)
time.sleep(3)  # ingestion is fire-and-forget on lecture creation
s, sess, _ = call("POST", "/ai/chat/sessions", student, {"courseId": cid})
sid = sess.get("id") or sess.get("session_id")
s, msg, _ = call("POST", f"/ai/chat/sessions/{sid}/messages", student,
                 {"message": "Why does quicksort degrade to O(n^2) on sorted input?"})
check("FR-A1", s == 200 and msg.get("reply"), "course-scoped chat answers")
srcs = msg.get("sources") or []
check("FR-A2", any(x.get("lecture_id") in lectures for x in srcs), f"RAG citations: {len(srcs)} source(s)")
s, _, _ = call("PUT", f"/ai/chat/sessions/{sid}/mode", student, {"mode": "advanced"})
_, msg2, _ = call("POST", f"/ai/chat/sessions/{sid}/messages", student, {"message": "And merge sort?"})
check("FR-A6", s == 200 and msg2.get("mode") == "advanced", f"mode switched → {msg2.get('mode')}")
s, summ, _ = call("POST", f"/ai/lectures/{lectures[0]}/summarize", student, {})
check("FR-A3", s == 200 and (summ.get("summary") or summ.get("key_points")), "lecture summary")
s, plan, _ = call("POST", "/ai/study-plan", student, {"course_id": cid})
check("FR-A4", s == 200 and plan, "study plan from quiz history")
s_stu, _, _ = call("POST", f"/ai/lectures/{lectures[0]}/generate-quiz", student, {})
s, gq, _ = call("POST", f"/ai/lectures/{lectures[0]}/generate-quiz", instructor, {})
n = gq.get("question_count", 0)
check("FR-A5", s in (200, 201) and 5 <= n <= 10 and not gq.get("demo_mode"),
      f"AI quiz draft: {n} questions from the LLM; student attempt → {s_stu}")
draft = gq.get("quiz_id")
_, cd_student, _ = call("GET", f"/courses/{cid}", student)
student_sees = any(q.get("id") == draft for m in cd_student.get("modules", []) for q in m.get("quizzes", []))
s_hidden, _, _ = call("GET", f"/quizzes/{draft}", student)
s_appr, appr, _ = call("PUT", f"/quizzes/{draft}/approve", instructor, {})
s_vis, _, _ = call("GET", f"/quizzes/{draft}", student)
check("FR-I4", not student_sees and s_hidden == 404 and s_appr == 200 and appr.get("status") == "published" and s_vis == 200,
      f"draft hidden from students ({s_hidden}) → approved → visible ({s_vis})")
s, fc, _ = call("POST", f"/ai/modules/{mid}/flashcards", student, {})
cards = fc.get("cards") or fc.get("flashcards") or []
check("FR-A7", s in (200, 201) and len(cards) > 0, f"{len(cards)} flashcards")
rows = []
for _ in range(15):  # recomputed by the background mastery queue
    _, mastery, _ = call("GET", f"/users/me/mastery?course_id={cid}", student)
    rows = mastery.get("items") or mastery.get("topics") or mastery.get("modules") or []
    if rows:
        break
    time.sleep(1)
check("FR-A8", len(rows) > 0, f"{len(rows)} topic-mastery row(s) written by the mastery job")
s, rec, _ = call("GET", "/recommendations/me", student)
check("FR-S10", s == 200 and "items" in rec, f"{len(rec.get('items', []))} recommendation(s)")

# ------------------------------------------------- Instructor analytics / news
s, an, _ = call("GET", f"/courses/{cid}/analytics", instructor)
blob = json.dumps(an).lower()
check("FR-I5", s == 200 and "drop" in blob and "score" in blob and ("time" in blob or "watch" in blob),
      "drop-off, average score, time-on-task")
call("POST", f"/courses/{cid}/announcements", instructor, {"title": "Exam Friday", "content": f"Exam {tag} on Friday."})
_, notif, _ = call("GET", "/users/me/notifications", student)
check("FR-I6", any(tag in (x.get("body") or "") for x in notif.get("items", [])), "announcement reaches student")

# ------------------------------------------------------------ Admin (AD2–AD5)
victim_email = f"victim-{tag}@example.com"
_, v, _ = call("POST", "/auth/register", body={"full_name": "Victim", "email": victim_email, "password": PASSWORD})
vid = v["user"]["id"]
call("PUT", f"/admin/users/{vid}/suspend", admin, {"is_active": False})
s_blocked, _, _ = call("POST", "/auth/login", body={"email": victim_email, "password": PASSWORD})
call("PUT", f"/admin/users/{vid}/suspend", admin, {"is_active": True})
check("FR-AD2", s_blocked == 403 and login(victim_email), f"suspended login → {s_blocked}, restored login OK")

_, ov, _ = call("GET", "/admin/analytics/overview", admin)
blob = json.dumps(ov).lower()
check("FR-AD3", all(k in blob for k in ("dau", "enrol", "completion", "revenue")), "DAU, enrolments, completion, revenue")

s, roles, _ = call("PUT", f"/admin/users/{vid}/role", admin, {"role": "instructor"})
check("FR-AD4", s == 200 and roles.get("roles") == ["instructor"], f"role → {roles.get('roles')}")

_, th, _ = call("POST", f"/courses/{cid}/threads", student, {"title": "Pivot question", "content": "How to pick?"})
thread_id = th.get("id") or th.get("thread", {}).get("id")
_, post, _ = call("POST", f"/threads/{thread_id}/posts", instructor, {"content": "Spam spam spam"})
call("POST", f"/posts/{post.get('id')}/flag", student, {})
_, flagged, _ = call("GET", "/admin/moderation/flagged-posts", admin)
listed = any(p.get("id") == post.get("id") for p in flagged.get("items", []))
s, _, _ = call("DELETE", f"/admin/moderation/posts/{post.get('id')}", admin)
check("FR-AD5", listed and s == 200, "flag → moderation queue → removed")

# ------------------------------------------------------------ NFR spot checks
s, err, _ = call("POST", "/auth/register", body={"full_name": "X", "email": "not-an-email", "password": PASSWORD})
e = err.get("error", {})
check("§8.8", s == 400 and e.get("code") == "VALIDATION_ERROR" and e.get("field") and e.get("message"),
      f"error envelope {e}")
s, _, _ = call("GET", "/admin/users", student)
check("RBAC", s == 403, "student blocked from admin API")
_, _, hdr = call("GET", "/courses")
check("§8.9", hdr.get("ratelimit-limit") or hdr.get("RateLimit-Limit"), "rate-limit headers present")

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
