/**
 * What the app accepts as an uploaded file, in one place.
 *
 * These limits used to live inside `DocumentsPanel`. A second uploader now
 * exists — the one in a pipeline-step dialog (client feedback, 2026-09-14) —
 * and two components each holding their own idea of "5 MB, PDF or image" is
 * how one of them quietly starts accepting something the other rejects.
 *
 * The ceiling itself is now a policy decision rather than a technical one:
 * files go to `server/storage` (a disk today, a bucket later), not into a
 * browser database. It is kept where it was because the client asked for 5 MB
 * and because a limit agreed with them should be one line to change.
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/*
 * Video joined in L7 for BRD SITE-001 ("photos, video and GPS"). A walk of the
 * boundary on a phone says more than twenty photos, and it is larger, so video
 * has its own ceiling.
 */
export const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

export const ACCEPTED_UPLOAD_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  ...ACCEPTED_VIDEO_TYPES,
] as const;

export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

export const ACCEPTED_UPLOAD_LABEL = 'PDF or image up to 5 MB, video (MP4, WEBM, MOV) up to 25 MB';

export function isVideoType(type?: string | null): boolean {
  return Boolean(type?.startsWith('video/'));
}

/** The size ceiling for a file of this type. */
export function maxBytesFor(type: string): number {
  return isVideoType(type) ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES;
}

export function formatFileSize(bytes?: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * `null` when the file is fine, otherwise the sentence to show the user.
 *
 * Takes the three facts rather than a `File`, so the **server** applies the
 * same rule to an upload that never came from this drop zone — a mobile app,
 * `scripts/demo`, or curl. A check in a browser is a courtesy, not a limit.
 */
export function rejectUploadOf(name: string, type: string, size: number): string | null {
  if (!(ACCEPTED_UPLOAD_TYPES as readonly string[]).includes(type)) {
    return `"${name}" cannot be uploaded — only PDF, PNG, JPG, WEBP, MP4, WEBM and MOV are accepted`;
  }
  if (size > maxBytesFor(type)) {
    return `"${name}" is ${formatFileSize(size)} — the limit is ${formatFileSize(maxBytesFor(type))}`;
  }
  return null;
}

/** The same, for a file the browser already has in hand. */
export function rejectUpload(file: File): string | null {
  return rejectUploadOf(file.name, file.type, file.size);
}
