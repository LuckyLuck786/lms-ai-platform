import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

/**
 * Durable file storage for uploaded material (PRD §9.1).
 *
 * Current driver writes under `./uploads`, which the API serves statically at
 * `/uploads` (see app.ts). Every caller goes through `persistFile`, so moving
 * to S3/MinIO means implementing one function — `env.s3` already carries the
 * endpoint, bucket and credentials.
 *
 * NOTE for container deploys: local disk is reset on every redeploy, so
 * uploads are ephemeral until the S3 driver is wired in.
 */

export const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');

/**
 * Staging area for in-flight uploads. Kept out of UPLOAD_ROOT so partially
 * received files are never reachable through the static /uploads mount.
 */
export const UPLOAD_TMP = path.join(os.tmpdir(), 'lms-uploads');

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
  const dir = path.join(UPLOAD_ROOT, folder);
  ensureDir(dir);

  const slug = safeSlug(originalName);
  const filename = `${crypto.randomUUID()}${slug ? `-${slug}` : ''}${safeExtension(originalName)}`;
  const dest = path.join(dir, filename);

  try {
    // Same filesystem in dev, so this is an atomic move.
    await fs.promises.rename(tmpPath, dest);
  } catch {
    await fs.promises.copyFile(tmpPath, dest);
    await fs.promises.unlink(tmpPath).catch(() => undefined);
  }

  const stat = await fs.promises.stat(dest);
  return {
    key: `${folder}/${filename}`,
    url: `/uploads/${folder}/${filename}`,
    size: stat.size,
    contentType,
    originalName,
  };
}

/** Which driver is active — surfaced in admin diagnostics. */
export function storageDriver(): 'local' {
  return 'local';
}
