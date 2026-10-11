import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import type { Response } from 'express';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Durable file storage for uploaded material (PRD §9.1).
 *
 * Two drivers, chosen by configuration:
 *  - `gcs`  — when GCS_BUCKET is set, objects live in Google Cloud Storage and
 *             are streamed back through the API's /uploads route. Durable
 *             across redeploys and shared by every Cloud Run instance.
 *  - `local`— otherwise the file lands under `./uploads`, which is what local
 *             development and docker-compose use.
 *
 * Every caller goes through `persistFile`, so the driver choice is invisible
 * to the routers; stored URLs are always `/uploads/<key>` either way.
 */

export const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');

/**
 * Staging area for in-flight uploads. Kept out of UPLOAD_ROOT so partially
 * received files are never reachable through the static /uploads mount.
 */
export const UPLOAD_TMP = path.join(os.tmpdir(), 'lms-uploads');

/** Lazily created GCS client — only constructed when a bucket is configured. */
let gcsBucketPromise: Promise<import('@google-cloud/storage').Bucket> | null = null;

async function gcsBucket(): Promise<import('@google-cloud/storage').Bucket> {
  gcsBucketPromise ??= (async () => {
    const { Storage } = await import('@google-cloud/storage');
    const storage = new Storage();
    return storage.bucket(env.gcs.bucket);
  })();
  return gcsBucketPromise;
}

export interface StoredFile {
  /** Path within the bucket/upload root, e.g. "lectures/<uuid>.pdf". */
  key: string;
  /** URL the frontend can fetch, e.g. "/uploads/lectures/<uuid>.pdf". */
  url: string;
  size: number;
  contentType: string;
  originalName: string;
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Extract a safe extension from a client-supplied filename.
 * Anything that is not a short alphanumeric extension is dropped entirely.
 */
export function safeExtension(originalName: string): string {
  const ext = path.extname(originalName ?? '').toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}

/**
 * Slugify the stem of a client filename so the stored key stays readable:
 * "Query Plans v2.pptx" -> "query-plans-v2". Purely cosmetic and always
 * prefixed by a random UUID, so it can never collide or be trusted as a path.
 */
export function safeSlug(originalName: string, maxLength = 60): string {
  const stem = path.basename(originalName ?? '', safeExtension(originalName ?? ''));
  return stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

/**
 * Move an already-received temp file into durable storage.
 * Returns the public URL to store on the row.
 */
export async function persistFile(
  tmpPath: string,
  originalName: string,
  folder: string,
  contentType = 'application/octet-stream',
): Promise<StoredFile> {
  const slug = safeSlug(originalName);
  const filename = `${crypto.randomUUID()}${slug ? `-${slug}` : ''}${safeExtension(originalName)}`;
  const key = `${folder}/${filename}`;
  const stat = await fs.promises.stat(tmpPath);

  if (env.gcs.bucket) {
    const bucket = await gcsBucket();
    await bucket.upload(tmpPath, {
      destination: key,
      resumable: false,
      contentType,
      metadata: { cacheControl: 'public, max-age=3600' },
    });
    await fs.promises.unlink(tmpPath).catch(() => undefined);
    logger.info('upload_stored', { driver: 'gcs', key, size: stat.size });
  } else {
    const dir = path.join(UPLOAD_ROOT, folder);
    ensureDir(dir);
    const dest = path.join(dir, filename);
    try {
      // Same filesystem in dev, so this is an atomic move.
      await fs.promises.rename(tmpPath, dest);
    } catch {
      await fs.promises.copyFile(tmpPath, dest);
      await fs.promises.unlink(tmpPath).catch(() => undefined);
    }
  }

  return {
    key,
    url: `/uploads/${key}`,
    size: stat.size,
    contentType,
    originalName,
  };
}

/** Remove a stored object (used when an upload is rejected after receipt). */
export async function deleteStoredFile(key: string): Promise<void> {
  if (env.gcs.bucket) {
    const bucket = await gcsBucket();
    await bucket.file(key).delete({ ignoreNotFound: true });
    return;
  }
  await fs.promises.unlink(path.join(UPLOAD_ROOT, key)).catch(() => undefined);
}

/**
 * Stream a stored object to the HTTP response.
 *
 * Returns false when the driver is `local` (the static handler takes over) and
 * throws for a missing GCS object so the error handler returns a clean 404.
 */
export async function streamStoredFile(key: string, res: Response): Promise<boolean> {
  if (!env.gcs.bucket) return false;
  const bucket = await gcsBucket();
  const file = bucket.file(key);
  const [exists] = await file.exists();
  if (!exists) return false;

  const [metadata] = await file.getMetadata();
  res.setHeader('Content-Type', String(metadata.contentType ?? 'application/octet-stream'));
  if (metadata.size) res.setHeader('Content-Length', String(metadata.size));
  res.setHeader('Cache-Control', 'public, max-age=3600');
  await new Promise<void>((resolve, reject) => {
    const read = file.createReadStream();
    read.on('error', reject);
    res.on('finish', resolve);
    res.on('close', resolve);
    Readable.from(read).pipe(res);
  });
  return true;
}

/** Which driver is active — surfaced in admin diagnostics. */
export function storageDriver(): 'gcs' | 'local' {
  return env.gcs.bucket ? 'gcs' : 'local';
}
