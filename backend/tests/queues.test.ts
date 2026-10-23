import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Every enqueue helper swallows errors (a queue outage must not fail the
 * request), so an invalid job id disables a queue silently. BullMQ rejects
 * custom ids containing ':' — that exact bug stopped topic-mastery recompute
 * in production. This test captures every job id and checks it.
 */

const added: { name: string; opts: { jobId?: string } }[] = [];
// Simulated job store: id → state, as BullMQ keeps finished jobs around.
const store = new Map<string, string>();

vi.mock('bullmq', () => ({
  Queue: class {
    async getJob(id: string) {
      const state = store.get(id);
      return state
        ? { getState: async () => state, remove: async () => void store.delete(id) }
        : undefined;
    }
    async add(name: string, _data: unknown, opts: { jobId?: string } = {}) {
      if (opts.jobId?.includes(':')) throw new Error('Custom Id cannot contain :');
      if (opts.jobId && store.has(opts.jobId)) return; // BullMQ ignores duplicate ids
      if (opts.jobId) store.set(opts.jobId, 'waiting');
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
  store.clear();
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

describe('deduplicated re-runs', () => {
  it('runs a key again once its previous job has finished', async () => {
    await queueMasteryRecompute({ userId: ID, courseId: ID });
    const id = added[0].opts.jobId!;
    store.set(id, 'completed'); // first recompute finished and is retained

    await queueMasteryRecompute({ userId: ID, courseId: ID });
    expect(added).toHaveLength(2);
  });

  it('still collapses a burst while one is pending', async () => {
    await queueMasteryRecompute({ userId: ID, courseId: ID });
    await queueMasteryRecompute({ userId: ID, courseId: ID });
    expect(added).toHaveLength(1);
  });
});
