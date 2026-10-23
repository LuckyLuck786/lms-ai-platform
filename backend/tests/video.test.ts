import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Video → HLS pipeline (PRD §9.4). One call advances one step; these pin the
 * transitions the worker relies on: start a job, keep polling while it runs,
 * record the CDN URL on success, and stop (not loop) on failure.
 */

const { queryOneMock, queryMock, createJob, getJob } = vi.hoisted(() => ({
  queryOneMock: vi.fn(),
  queryMock: vi.fn().mockResolvedValue([]),
  createJob: vi.fn(),
  getJob: vi.fn(),
}));

vi.mock('../src/db/pool', () => ({ queryOne: queryOneMock, query: queryMock, pool: {} }));
vi.mock('@google-cloud/video-transcoder', () => ({
  TranscoderServiceClient: class {
    locationPath(p: string, l: string) {
      return `projects/${p}/locations/${l}`;
    }
    createJob = createJob;
    getJob = getJob;
  },
}));

process.env.VIDEO_BUCKET = 'video-bucket';
process.env.VIDEO_CDN_BASE = 'https://cdn.example/';
process.env.GOOGLE_CLOUD_PROJECT = 'proj';
process.env.GCS_BUCKET = 'media-bucket';

const { processLectureVideo, hlsUrlFor, videoPipelineEnabled } = await import('../src/services/video');

const LECTURE = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  queryOneMock.mockReset();
  queryMock.mockClear();
  createJob.mockReset();
  getJob.mockReset();
});

describe('video pipeline', () => {
  it('is enabled once bucket, CDN and project are configured', () => {
    expect(videoPipelineEnabled()).toBe(true);
    expect(hlsUrlFor(LECTURE)).toBe(`https://cdn.example/hls/${LECTURE}/manifest.m3u8`);
  });

  it('starts a web-hd Transcoder job for an uploaded file, reading it straight from the media bucket', async () => {
    queryOneMock.mockResolvedValue({ video_url: '/uploads/lectures/a.mp4', hls_status: null, hls_job: null });
    createJob.mockResolvedValue([{ name: 'jobs/1' }]);

    await expect(processLectureVideo(LECTURE)).resolves.toBe('pending');

    const req = createJob.mock.calls[0][0];
    expect(req.parent).toBe('projects/proj/locations/us-central1');
    expect(req.job).toEqual({
      inputUri: 'gs://media-bucket/lectures/a.mp4',
      outputUri: `gs://video-bucket/hls/${LECTURE}/`,
      templateId: 'preset/web-hd',
    });
    expect(queryMock.mock.calls[0][1]).toEqual([LECTURE, 'jobs/1']);
  });

  it('keeps polling while the job runs', async () => {
    queryOneMock.mockResolvedValue({ video_url: '/uploads/x.mp4', hls_status: 'processing', hls_job: 'jobs/1' });
    getJob.mockResolvedValue([{ state: 'RUNNING' }]);
    await expect(processLectureVideo(LECTURE)).resolves.toBe('pending');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('records the CDN manifest when the job succeeds', async () => {
    queryOneMock.mockResolvedValue({ video_url: '/uploads/x.mp4', hls_status: 'processing', hls_job: 'jobs/1' });
    getJob.mockResolvedValue([{ state: 'SUCCEEDED' }]);
    await expect(processLectureVideo(LECTURE)).resolves.toBe('done');
    expect(queryMock.mock.calls[0][1]).toEqual([LECTURE, hlsUrlFor(LECTURE)]);
  });

  it('marks the lecture failed and stops, instead of polling forever', async () => {
    queryOneMock.mockResolvedValue({ video_url: '/uploads/x.mp4', hls_status: 'processing', hls_job: 'jobs/1' });
    getJob.mockResolvedValue([{ state: 'FAILED', error: { message: 'bad codec' } }]);
    await expect(processLectureVideo(LECTURE)).resolves.toBe('done');
    expect(String(queryMock.mock.calls[0][0])).toMatch(/hls_status = 'failed'/);
  });

  it('retries a silent source once with the video-only ladder', async () => {
    queryOneMock.mockResolvedValue({ video_url: '/uploads/x.mp4', hls_status: 'processing', hls_job: 'jobs/1' });
    getJob.mockResolvedValue([
      {
        // Shape the API really returns for a preset job: no templateId, no
        // top-level inputUri — both live in the expanded config.
        state: 'FAILED',
        config: {
          inputs: [{ key: 'input0', uri: 'gs://media-bucket/x.mp4' }],
          elementaryStreams: [{ key: 'v', videoStream: {} }, { key: 'a', audioStream: {} }],
        },
        error: { message: 'atom atom0 does not have any inputs ([input0]) with an audio track' },
      },
    ]);
    createJob.mockResolvedValue([{ name: 'jobs/2' }]);
    await expect(processLectureVideo(LECTURE)).resolves.toBe('pending');
    const job = createJob.mock.calls[0][0].job;
    expect(job.inputUri).toBe('gs://media-bucket/x.mp4');
    expect(job.templateId).toBeUndefined();
    expect(job.config.manifests[0].fileName).toBe('manifest.m3u8');
    expect(queryMock.mock.calls[0][1]).toEqual([LECTURE, 'jobs/2']);
  });

  it('does not retry the video-only job itself', async () => {
    queryOneMock.mockResolvedValue({ video_url: '/uploads/x.mp4', hls_status: 'processing', hls_job: 'jobs/2' });
    getJob.mockResolvedValue([
      {
        state: 'FAILED',
        config: { inputs: [{ uri: 'gs://media-bucket/x.mp4' }], elementaryStreams: [{ key: 'v', videoStream: {} }] },
        error: { message: 'something about audio' },
      },
    ]);
    await expect(processLectureVideo(LECTURE)).resolves.toBe('done');
    expect(createJob).not.toHaveBeenCalled();
  });

  it('does nothing for a lecture without video or one already streaming', async () => {
    queryOneMock.mockResolvedValueOnce({ video_url: null, hls_status: null, hls_job: null });
    await expect(processLectureVideo(LECTURE)).resolves.toBe('done');
    queryOneMock.mockResolvedValueOnce({ video_url: '/uploads/x.mp4', hls_status: 'ready', hls_job: null });
    await expect(processLectureVideo(LECTURE)).resolves.toBe('done');
    expect(createJob).not.toHaveBeenCalled();
  });
});
