import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Every enqueue helper swallows errors (a queue outage must not fail the
 * request), so an invalid job id disables a queue silently. BullMQ rejects
 * custom ids containing ':' — that exact bug stopped topic-mastery recompute
 * in production. This test captures every job id and checks it.
 */

const added: { name: string; opts: { jobId?: string } }[] = [];

vi.mock('bullmq', () => ({
  Queue: class {
    async add(name: string, _data: unknown, opts: { jobId?: string } = {}) {
      if (opts.jobId?.includes(':')) throw new Error('Custom Id cannot contain :');
      added.push({ name, opts });
    }
    async upsertJobScheduler() {}
    async close() {}
  },
}));
vi.mock('ioredis', () => ({ default: class {} }));

import { queueIngestion, queueMasteryRecompute, queueTranscription } from '../src/jobs/queues';

const ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  added.length = 0;
});

describe('queue job ids', () => {
  it('deduplicating helpers produce ids BullMQ accepts', async () => {
    await queueMasteryRecompute({ userId: ID, courseId: ID });
    await queueTranscription({ lectureId: ID });
    await queueIngestion({ lectureId: ID });

    expect(added.map((a) => a.name)).toEqual(['recompute', 'transcribe', 'ingest']);
    for (const { opts } of added) {
      expect(opts.jobId).toBeTruthy();
      expect(opts.jobId).not.toContain(':');
    }
  });
});
