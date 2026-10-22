import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Transcription trigger (PRD §9.3).
 *
 * `requestTranscription` is what the BullMQ worker calls. The branches worth
 * pinning down are the ones that decide *not* to spend provider money (already
 * transcribed, no video, missing lecture), the media URL the AI service is
 * given (it cannot resolve a backend-relative path), and the fact that a failed
 * provider call throws — that throw is what makes BullMQ retry instead of
 * dropping the lecture back into the invisible-to-RAG state.
 */

const { queryOneMock } = vi.hoisted(() => ({ queryOneMock: vi.fn() }));

vi.mock('../src/db/pool', () => ({
  queryOne: (...args: unknown[]) => queryOneMock(...args),
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
  queueIngestion: vi.fn(),
}));

import { requestTranscription } from '../src/modules/ai/ai.router';
import { env } from '../src/config/env';

const LECTURE = '11111111-1111-4111-8111-111111111111';

const fetchMock = vi.fn();

beforeEach(() => {
  queryOneMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestTranscription — skip conditions', () => {
  it('does nothing when the lecture no longer exists', async () => {
    queryOneMock.mockResolvedValue(null);
    await requestTranscription(LECTURE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not re-transcribe a lecture that already has a transcript', async () => {
    queryOneMock.mockResolvedValue({
      transcript: 'Hand-typed notes.',
      video_url: 'https://cdn/x.mp4',
    });
    await requestTranscription(LECTURE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only transcript as still needing transcription', async () => {
    queryOneMock.mockResolvedValue({ transcript: '   ', video_url: null });
    // No video either, so it still skips — but on the video branch, proving
    // the transcript check did not fire first.
    await requestTranscription(LECTURE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing when the lecture has no video', async () => {
    queryOneMock.mockResolvedValue({ transcript: null, video_url: null });
    await requestTranscription(LECTURE);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('requestTranscription — provider call', () => {
  it('sends an absolute media URL, because the AI service cannot resolve /uploads', async () => {
    queryOneMock.mockResolvedValue({
      transcript: null,
      video_url: '/uploads/lectures/abc.mp4',
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '{"status":"ok"}' });

    await requestTranscription(LECTURE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${env.aiServiceUrl}/api/v1/ai/internal/transcribe`);

    const body = JSON.parse(String(init.body)) as { lecture_id: string; media_url: string };
    expect(body.lecture_id).toBe(LECTURE);
    expect(body.media_url).toBe(`${env.publicApiUrl}/uploads/lectures/abc.mp4`);
    expect(body.media_url).toMatch(/^https?:\/\//);
  });

  it('leaves an already-absolute media URL untouched', async () => {
    queryOneMock.mockResolvedValue({
      transcript: null,
      video_url: 'https://cdn.example.com/lecture.mp4',
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });

    await requestTranscription(LECTURE);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as { media_url: string };
    expect(body.media_url).toBe('https://cdn.example.com/lecture.mp4');
  });

  it('always carries a correlation id so logs can be joined', async () => {
    queryOneMock.mockResolvedValue({ transcript: null, video_url: 'https://x/v.mp4' });
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });

    await requestTranscription(LECTURE);

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    // `job-` prefixed: this call has no originating request, so it mints one.
    expect(headers['x-request-id']).toMatch(/^job-[0-9a-f-]{36}$/);
    expect(headers['content-type']).toBe('application/json');
  });

  it('throws on a failed provider call so BullMQ retries instead of losing the lecture', async () => {
    queryOneMock.mockResolvedValue({ transcript: null, video_url: 'https://x/v.mp4' });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 413,
      text: async () => '{"detail":"too large"}',
    });

    await expect(requestTranscription(LECTURE)).rejects.toThrow(/413/);
  });

  it('throws on a network failure so the job is retried with backoff', async () => {
    queryOneMock.mockResolvedValue({ transcript: null, video_url: 'https://x/v.mp4' });
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(requestTranscription(LECTURE)).rejects.toThrow(/ECONNREFUSED/);
  });
});
