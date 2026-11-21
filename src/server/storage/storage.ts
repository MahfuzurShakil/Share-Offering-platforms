import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Where an uploaded file actually goes.
 *
 * One narrow door — put, read, remove, keyed by an opaque storage key — so the
 * services never learn whether the bytes are on this disk or in a bucket. The
 * local implementation is what development and a single-VPS deployment use;
 * S3-compatible storage is the same three functions against a client, and
 * nothing above this file changes when it lands.
 *
 * The key is never a URL and never reaches the browser: a file is served by
 * `GET /documents/{id}/file`, which checks the permission first. That is the
 * whole reason `documents.storage_key` is left out of every DTO.
 */

export interface StoredFile {
  storage_key: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  /** of the bytes, so a re-upload of the same file can be recognised later */
  sha256: string;
}

/** The folder files are kept under. Outside the repository by default. */
function root(): string {
  return process.env.FILE_STORAGE_DIR?.trim() || path.join(process.cwd(), '.storage');
}

/**
 * A file name safe to put on a disk, keeping the extension.
 *
 * The name a browser sends is attacker-controlled: `../../.env`, a 300-byte
 * name, a NUL. The key is a uuid folder plus this, so two uploads of
 * `nid.pdf` cannot collide either.
 */
function safeName(name: string): string {
  const base = path.basename(name).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  const trimmed = base.slice(-120);
  return trimmed || 'file';
}

/** Resolves a key under the root, refusing anything that climbs out of it. */
function resolve(key: string): string {
  const full = path.resolve(root(), key);
  const base = path.resolve(root());
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error('That storage key is outside the store.');
  }
  return full;
}

/** Writes bytes and returns what the database should remember about them. */
export async function putFile(
  folder: string,
  file: { name: string; type: string; bytes: Buffer },
): Promise<StoredFile> {
  const name = safeName(file.name);
  const key = `${folder}/${randomUUID()}/${name}`;
  const full = resolve(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, file.bytes);
  return {
    storage_key: key,
    file_name: name,
    file_size: file.bytes.byteLength,
    mime_type: file.type,
    sha256: createHash('sha256').update(file.bytes).digest('hex'),
  };
}

/** The bytes back, or `null` when the file is not there any more. */
export async function readStoredFile(key: string): Promise<Buffer | null> {
  try {
    return await readFile(resolve(key));
  } catch {
    return null;
  }
}

/**
 * Deletes the bytes. Never throws: the row is what the product reads, and a
 * file already gone must not stop the record being removed.
 */
export async function removeStoredFile(key: string): Promise<void> {
  try {
    await rm(path.dirname(resolve(key)), { recursive: true, force: true });
  } catch {
    /* already gone */
  }
}
