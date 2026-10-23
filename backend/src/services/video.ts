import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { env } from '../config/env';
import { query, queryOne } from '../db/pool';
import { logger } from '../utils/logger';

/**
 * Lecture video → adaptive HLS → Cloud CDN (PRD §9.4, §13).
 *
 * One step per call, so the queue worker can poll a long-running Transcoder
 * job without holding a worker slot:
 *   1. no job yet  → stage the source in GCS, start a Transcoder job
 *   2. job running → report "pending" (the worker re-checks later)
 *   3. job done    → record the CDN manifest URL on the lecture
 *
 * The `preset/web-hd` template produces several renditions plus an HLS
 * master playlist, so players switch bitrate with the viewer's bandwidth.
 */

export type VideoStep = 'pending' | 'done';

/** Name of the HLS master playlist written by preset/web-hd. */
export const HLS_MANIFEST = 'manifest.m3u8';

/**
 * Fallback for silent sources: preset/web-hd needs an audio track and fails
 * without one ("does not have any inputs with an audio track"). This
 * video-only ladder keeps adaptive streaming for screen recordings and
 * silent clips. Width follows the source aspect ratio.
 */
const VIDEO_ONLY_CONFIG = {
  elementaryStreams: [
    { key: 'v360', videoStream: { h264: { heightPixels: 360, bitrateBps: 800_000, frameRate: 30 } } },
    { key: 'v720', videoStream: { h264: { heightPixels: 720, bitrateBps: 2_500_000, frameRate: 30 } } },
  ],
  muxStreams: [
    { key: 'hls-360', container: 'ts', elementaryStreams: ['v360'], segmentSettings: { segmentDuration: { seconds: 6 } } },
    { key: 'hls-720', container: 'ts', elementaryStreams: ['v720'], segmentSettings: { segmentDuration: { seconds: 6 } } },
  ],
  manifests: [{ fileName: HLS_MANIFEST, type: 'HLS' as const, muxStreams: ['hls-360', 'hls-720'] }],
};

/** Largest external source the pipeline will copy in (bytes). */
const MAX_SOURCE_BYTES = 2 * 1024 ** 3;

export function videoPipelineEnabled(): boolean {
  return !!(env.video.bucket && env.video.cdnBase && env.video.project && env.gcs.bucket);
}

export function hlsUrlFor(lectureId: string): string {
  return `${env.video.cdnBase}/hls/${lectureId}/${HLS_MANIFEST}`;
}

let transcoderPromise: Promise<import('@google-cloud/video-transcoder').TranscoderServiceClient> | null = null;
function transcoder() {
  transcoderPromise ??= import('@google-cloud/video-transcoder').then(
    ({ TranscoderServiceClient }) => new TranscoderServiceClient(),
  );
  return transcoderPromise;
}

async function storage() {
  const { Storage } = await import('@google-cloud/storage');
  return new Storage();
}

/**
 * Resolve the lecture's video to a gs:// URI the Transcoder can read.
 * Uploaded files already live in the media bucket; external URLs are copied
 * in first, because the Transcoder only reads Cloud Storage.
 */
async function stageSource(lectureId: string, videoUrl: string): Promise<string> {
  if (videoUrl.startsWith('/uploads/')) {
    return `gs://${env.gcs.bucket}/${decodeURIComponent(videoUrl.slice('/uploads/'.length))}`;
  }
  if (!/^https?:\/\//i.test(videoUrl)) throw new Error(`unsupported video URL: ${videoUrl}`);

  const res = await fetch(videoUrl, { signal: AbortSignal.timeout(600_000) });
  if (!res.ok || !res.body) throw new Error(`fetching source failed: HTTP ${res.status}`);
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_SOURCE_BYTES) throw new Error(`source too large: ${length} bytes`);

  const key = `video-src/${lectureId}.mp4`;
  const file = (await storage()).bucket(env.gcs.bucket).file(key);
  await pipeline(
    Readable.fromWeb(res.body as import('stream/web').ReadableStream),
    file.createWriteStream({ resumable: false, contentType: res.headers.get('content-type') ?? 'video/mp4' }),
  );
  return `gs://${env.gcs.bucket}/${key}`;
}

export async function processLectureVideo(lectureId: string): Promise<VideoStep> {
  const lecture = await queryOne<{
    video_url: string | null;
    hls_status: string | null;
    hls_job: string | null;
  }>('SELECT video_url, hls_status, hls_job FROM lectures WHERE id = $1', [lectureId]);

  if (!lecture?.video_url || lecture.hls_status === 'ready') return 'done';

  const client = await transcoder();

  if (!lecture.hls_job) {
    const inputUri = await stageSource(lectureId, lecture.video_url);
    const [job] = await client.createJob({
      parent: client.locationPath(env.video.project, env.video.location),
      job: {
        inputUri,
        outputUri: `gs://${env.video.bucket}/hls/${lectureId}/`,
        templateId: 'preset/web-hd',
      },
    });
    await query("UPDATE lectures SET hls_job = $2, hls_status = 'processing' WHERE id = $1", [
      lectureId,
      job.name,
    ]);
    logger.info('video_transcode_started', { lecture_id: lectureId, job: job.name });
    return 'pending';
  }

  const [job] = await client.getJob({ name: lecture.hls_job });
  const state = String(job.state);
  if (state === 'SUCCEEDED') {
    await query("UPDATE lectures SET hls_url = $2, hls_status = 'ready', hls_job = NULL WHERE id = $1", [
      lectureId,
      hlsUrlFor(lectureId),
    ]);
    logger.info('video_transcode_ready', { lecture_id: lectureId });
    return 'done';
  }
  if (state === 'FAILED') {
    // A silent source fails the audio+video preset; retry once video-only.
    // The API does not echo templateId for preset jobs, so "the failed job
    // asked for audio" is read from its expanded config instead — which also
    // stops the video-only retry from ever retrying itself.
    const wantedAudio = (job.config?.elementaryStreams ?? []).some((e) => !!e.audioStream);
    const inputUri = job.inputUri || job.config?.inputs?.[0]?.uri;
    if (wantedAudio && inputUri && /audio/i.test(job.error?.message ?? '')) {
      const [retry] = await client.createJob({
        parent: client.locationPath(env.video.project, env.video.location),
        job: {
          inputUri,
          outputUri: `gs://${env.video.bucket}/hls/${lectureId}/`,
          config: VIDEO_ONLY_CONFIG,
        },
      });
      await query('UPDATE lectures SET hls_job = $2 WHERE id = $1', [lectureId, retry.name]);
      logger.info('video_transcode_retry_video_only', { lecture_id: lectureId, job: retry.name });
      return 'pending';
    }
    await query("UPDATE lectures SET hls_status = 'failed', hls_job = NULL WHERE id = $1", [lectureId]);
    logger.error('video_transcode_failed', { lecture_id: lectureId, error: job.error?.message });
    return 'done';
  }
  return 'pending';
}

/** Lectures with a video that has never been transcoded (admin backfill). */
export async function lecturesNeedingVideo(): Promise<string[]> {
  const rows = await query<{ id: string }>(
    "SELECT id FROM lectures WHERE video_url IS NOT NULL AND (hls_status IS NULL OR hls_status = 'failed')",
  );
  return rows.map((r) => r.id);
}
