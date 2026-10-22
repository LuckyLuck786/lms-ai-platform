// Load baseline for NFR §6: non-AI endpoints p95 < 300 ms at 100 concurrent users.
//
//   k6 run -e API=https://<backend>/api/v1 infra/load/k6-core.js
//
// AI routes are excluded on purpose: the PRD scopes the latency target to
// non-AI endpoints, and hammering the LLM providers would only measure them.
import http from 'k6/http';
import { check, sleep } from 'k6';

const API = __ENV.API || 'http://localhost:4000/api/v1';
const EMAIL = __ENV.EMAIL || 'student@vertexon.demo';
const PASSWORD = __ENV.PASSWORD || 'DemoPass123!';

export const options = {
  stages: [
    { duration: '20s', target: 100 },
    { duration: '60s', target: 100 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    'http_req_duration{kind:core}': ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
  },
};

// One login for the whole run: /auth/* is limited to 10 req/min/IP (PRD §8.9),
// so per-VU logins would measure the rate limiter, not the API.
export function setup() {
  const res = http.post(`${API}/auth/login`, JSON.stringify({ email: EMAIL, password: PASSWORD }), {
    headers: { 'content-type': 'application/json' },
  });
  check(res, { 'login ok': (r) => r.status === 200 });
  return { token: res.json('access_token') };
}

export default function (data) {
  const auth = { headers: { authorization: `Bearer ${data.token}` }, tags: { kind: 'core' } };
  const pub = { tags: { kind: 'core' } };

  check(http.get(`${API}/courses?page=1&limit=12`, pub), { catalog: (r) => r.status === 200 });
  check(http.get(`${API}/enrollments/me`, auth), { enrollments: (r) => r.status === 200 });
  check(http.get(`${API}/users/me/streak`, auth), { streak: (r) => r.status === 200 });
  sleep(1);
}
