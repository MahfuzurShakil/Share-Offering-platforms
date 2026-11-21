import { Prisma } from '@prisma/client';
import { currentActorId } from '../audit/audit';
import { prisma } from '../db/prisma';
import { invalid, notFound } from '../http/respond';
import { putFile, readStoredFile, removeStoredFile } from '../storage/storage';
import { rejectUploadOf } from '@/lib/domain/file-upload';
import type { PermissionModule } from '@/lib/domain/permissions';

/**
 * Documents — the papers that hang off every other record.
 *
 * One table and one panel serve the whole product (a project's drawings, a
 * customer's NID, an offering's valuation report), which is why this service
 * exists rather than each module growing its own uploader. The file itself
 * goes through `server/storage`, so what the database holds is a storage key
 * and what the browser gets is an id.
 *
 * The permission is the *owning record's*: whoever may edit a project may
 * attach its papers, and somebody who may only open Leads cannot read a
 * customer's identity documents by guessing an id. That mapping is the whole
 * of `MODULE_OF`, and it is why every function here takes the entity type —
 * or looks it up — before it does anything.
 */

/** Which desk owns the papers of which record. */
const MODULE_OF: Record<string, PermissionModule> = {
  project: 'project',
  lead: 'crm',
  customer: 'share_sale',
  share_offering: 'share_sale',
  share_sale: 'share_sale',
  share_payment: 'finance_collection',
  blog_post: 'website',
  company: 'master_data',
};

/** The entity types this product attaches documents to, for the route's zod. */
export const DOCUMENT_ENTITY_TYPES = Object.keys(MODULE_OF) as [string, ...string[]];

/** The module a caller needs rights on to touch this record's papers. */
export function moduleForEntity(entityType: string): PermissionModule {
  const owner = MODULE_OF[entityType];
  if (!owner) throw invalid('Documents are not kept against that kind of record.');
  return owner;
}

/**
 * Only these records have files the public website or the investor portal may
 * serve, so `is_public` is offered nowhere else (PUBLIC-WEBSITE-MASTER-PLAN
 * 10.2). Setting it elsewhere would be a flag that does nothing — or, worse,
 * one that starts doing something later.
 */
const PUBLISHABLE = new Set(['project', 'blog_post']);

const SELECT = {
  id: true,
  entity_type: true,
  entity_id: true,
  document_type: true,
  custom_type_name: true,
  external_url: true,
  file_name: true,
  file_size: true,
  mime_type: true,
  document_no: true,
  is_public: true,
  notes: true,
  uploaded_by: true,
  uploaded_at: true,
  storage_key: true,
} satisfies Prisma.DocumentSelect;

type DocumentRow = Prisma.DocumentGetPayload<{ select: typeof SELECT }>;

/**
 * A document as a screen receives it.
 *
 * `storage_key` is read but never sent: the bytes are served by
 * `GET /documents/{id}/file`, which checks the permission first, so the
 * browser never holds a path to anything.
 */
export interface DocumentDto {
  id: string;
  entity_type: string;
  entity_id: string;
  document_type: string;
  custom_type_name: string | null;
  /** for a paper that lives somewhere else entirely */
  external_url: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  document_no: string | null;
  is_public: boolean;
  notes: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  /** true when there are bytes to fetch */
  has_file: boolean;
}

function toDto(row: DocumentRow): DocumentDto {
  return {
    id: row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    document_type: row.document_type,
    custom_type_name: row.custom_type_name,
    external_url: row.external_url,
    file_name: row.file_name,
    file_size: row.file_size,
    mime_type: row.mime_type,
    document_no: row.document_no,
    is_public: row.is_public,
    notes: row.notes,
    uploaded_by: row.uploaded_by,
    uploaded_at: row.uploaded_at.toISOString(),
    has_file: Boolean(row.storage_key),
  };
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** One record's papers, newest first. */
export async function listDocuments(
  entityType: string,
  entityId: string,
): Promise<DocumentDto[]> {
  const rows = await prisma.document.findMany({
    where: { entity_type: entityType, entity_id: entityId },
    select: SELECT,
    orderBy: { uploaded_at: 'desc' },
  });
  return rows.map(toDto);
}

export async function getDocument(id: string): Promise<DocumentDto> {
  const row = await prisma.document.findFirst({ where: { id }, select: SELECT });
  if (!row) throw notFound('That document');
  return toDto(row);
}

/** The record a document hangs off, so a route can check the right module. */
export async function ownerOfDocument(
  id: string,
): Promise<{ entity_type: string; entity_id: string }> {
  const row = await prisma.document.findFirst({
    where: { id },
    select: { entity_type: true, entity_id: true },
  });
  if (!row) throw notFound('That document');
  return row;
}

/** The bytes, for the route that serves them. */
export async function readDocumentFile(
  id: string,
): Promise<{ bytes: Buffer; mime: string; name: string }> {
  const row = await prisma.document.findFirst({
    where: { id },
    select: { storage_key: true, mime_type: true, file_name: true },
  });
  if (!row) throw notFound('That document');
  if (!row.storage_key) throw notFound('A file for that document');
  const bytes = await readStoredFile(row.storage_key);
  if (!bytes) throw notFound('The file for that document');
  return {
    bytes,
    mime: row.mime_type ?? 'application/octet-stream',
    name: row.file_name ?? 'document',
  };
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

export interface DocumentUpload {
  entity_type: string;
  entity_id: string;
  document_type: string;
  custom_type_name?: string | null;
  is_public?: boolean;
  notes?: string | null;
}

/**
 * Takes an uploaded file and records it against its entity.
 *
 * The type and the size are checked here, with the same rules the drop zone
 * uses (`lib/domain/file-upload.ts`), because a check in a browser is a
 * courtesy and not a limit — this API is also what the mobile apps and
 * `scripts/demo` call.
 */
export async function uploadDocument(
  input: DocumentUpload,
  file: { name: string; type: string; bytes: Buffer },
): Promise<DocumentDto> {
  moduleForEntity(input.entity_type);

  if (!input.document_type.trim()) {
    throw invalid('Pick a document type.', { document_type: 'Required.' });
  }
  if (input.document_type === 'other' && !input.custom_type_name?.trim()) {
    throw invalid('Give this document a name.', { custom_type_name: 'Required.' });
  }
  if (file.bytes.byteLength === 0) throw invalid('That file is empty.', { file: 'Empty file.' });
  const rejected = rejectUploadOf(file.name, file.type, file.bytes.byteLength);
  if (rejected) throw invalid(rejected, { file: rejected });

  const stored = await putFile('documents', file);
  const isPublic = PUBLISHABLE.has(input.entity_type) ? Boolean(input.is_public) : false;

  try {
    const row = await prisma.document.create({
      data: {
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        document_type: input.document_type,
        custom_type_name:
          input.document_type === 'other' ? (input.custom_type_name?.trim() ?? null) : null,
        storage_key: stored.storage_key,
        file_name: stored.file_name,
        file_size: stored.file_size,
        mime_type: stored.mime_type,
        is_public: isPublic,
        notes: input.notes?.trim() || null,
        uploaded_by: currentActorId(),
        created_by: currentActorId(),
      },
      select: SELECT,
    });
    return toDto(row);
  } catch (error) {
    /* the row is what the product reads, so an orphaned file is swept up now */
    await removeStoredFile(stored.storage_key);
    throw error;
  }
}

/** On the website, or internal. */
export async function setDocumentPublic(id: string, isPublic: boolean): Promise<DocumentDto> {
  const owner = await ownerOfDocument(id);
  if (isPublic && !PUBLISHABLE.has(owner.entity_type)) {
    throw invalid('The website does not show that kind of record.');
  }
  const row = await prisma.document.update({
    where: { id },
    data: { is_public: isPublic },
    select: SELECT,
  });
  return toDto(row);
}

/**
 * Removes a document.
 *
 * The row soft-deletes, as every non-financial record does, but the **file is
 * deleted for real**: a hidden identity document whose bytes are still on the
 * disk is exactly what a client gets asked about. The row stays, with its
 * name and who uploaded it, which is what the audit trail needs.
 */
export async function deleteDocument(id: string): Promise<void> {
  const row = await prisma.document.findFirst({ where: { id }, select: { storage_key: true } });
  if (!row) throw notFound('That document');
  await prisma.document.delete({ where: { id } });
  if (row.storage_key) await removeStoredFile(row.storage_key);
}
