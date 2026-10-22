import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Nightly recommendation recalculation (PRD §9.3).
 *
 * `requestRecommendationRecompute` is what the scheduled worker job calls. The
 * contract worth pinning: it presents the internal token and the request id
 * the AI service logs against, and a failed batch throws — that throw is what
 * makes BullMQ record and retry the night's run instead of silently skipping it.
 */

vi.mock('../src/db/pool', () => ({
  queryOne: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  pool: {},
  withTransaction: vi.fn(),
}));

vi.mock('../src/db/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn() },
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheDel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/jobs/queues', () => ({
  queueCertificate: vi.fn(),
  queueEmail: vi.fn(),
  queueMasteryRecompute: vi.fn(),
  queueTranscription: vi.fn(),
}));

import { requestRecommendationRecompute } from '../src/modules/ai/ai.router';
import { env } from '../src/config/env';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestRecommendationRecompute', () => {
  it('posts to the internal recompute endpoint and returns the summary', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ users: 4, updated: 3, failed: 1 }), { status: 200 }),
    );

    await expect(requestRecommendationRecompute()).resolves.toEqual({
      users: 4,
      updated: 3,
      failed: 1,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${env.aiServiceUrl}/api/v1/ai/internal/recommendations/recompute`);
    expect(init.method).toBe('POST');
    expect(init.headers['x-request-id']).toBeTruthy();
  });

  it('throws on a non-2xx so the scheduled job is retried', async () => {
    fetchMock.mockResolvedValue(new Response('db down', { status: 503 }));
    await expect(requestRecommendationRecompute()).rejects.toThrow(/HTTP 503/);
  });
});
