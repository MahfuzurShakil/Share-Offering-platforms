'use client';

import { api } from './client';

/**
 * Documents — one client for every module's papers.
 *
 * The method names are the prototype's `documentRepository` ones, so the
 * panels that used it change by their import line.
 */

/** The entity types papers are kept against. Mirrors the service's map. */
export type DocumentEntity =
  | 'project'
  | 'lead'
  | 'customer'
  | 'share_offering'
  | 'share_sale'
  | 'share_payment'
  | 'blog_post'
  | 'company';

export interface ApiDocument {
  id: string;
  entity_type: DocumentEntity;
  entity_id: string;
  document_type: string;
  custom_type_name: string | null;
  external_url: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  document_no: string | null;
  is_public: boolean;
  notes: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  /** false for a paper recorded without a file (an external link) */
  has_file: boolean;
}

export interface DocumentUploadInput {
  entity_type: DocumentEntity;
  entity_id: string;
  document_type: string;
  custom_type_name?: string | null;
  notes?: string | null;
  is_public?: boolean;
  file: File;
}

export const documentsApi = {
  listForEntity(entity_type: DocumentEntity, entity_id: string, signal?: AbortSignal) {
    return api.get<ApiDocument[]>('/documents', { entity_type, entity_id }, signal);
  },

  upload(input: DocumentUploadInput) {
    const form = new FormData();
    form.set('entity_type', input.entity_type);
    form.set('entity_id', input.entity_id);
    form.set('document_type', input.document_type);
    if (input.custom_type_name) form.set('custom_type_name', input.custom_type_name);
    if (input.notes) form.set('notes', input.notes);
    if (input.is_public) form.set('is_public', 'true');
    form.set('file', input.file);
    return api.upload<ApiDocument>('/documents', form);
  },

  setPublic(id: string, is_public: boolean) {
    return api.patch<ApiDocument>(`/documents/${id}`, { is_public });
  },

  remove(id: string) {
    return api.del<void>(`/documents/${id}`);
  },

  /** The bytes, for the viewer and for a download. */
  file(id: string, signal?: AbortSignal) {
    return api.blob(`/documents/${id}/file`, signal);
  },
};

/**
 * The path an `<img>` can point straight at.
 *
 * The browser sends the session cookie with an image request, so a picture
 * needs no blob fetch — and the route still checks the permission, so this is
 * not a public URL in disguise.
 */
export function documentFileUrl(id: string): string {
  return `/api/v1/documents/${id}/file`;
}

export const documentKeys = {
  all: ['documents'] as const,
  forEntity: (entity_type: DocumentEntity, entity_id: string) =>
    ['documents', entity_type, entity_id] as const,
};
