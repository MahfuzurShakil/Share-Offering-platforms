'use client';

import { useState } from 'react';
import { Eye, FileText, Trash2, Upload, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Checkbox, Field, SelectInput, TextArea, TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { DocRow, FileDropZone, FileViewer, type ViewerFile } from './DocumentParts';
import { WEBSITE_ENTITIES, WebsiteToggle } from './WebsiteToggle';
import { messageOf } from '@/lib/api/client';
import {
  documentKeys,
  documentsApi,
  type ApiDocument,
  type DocumentEntity,
} from '@/lib/api/documents';
import { lookupKeys, lookupsApi } from '@/lib/api/lookups';
import { useApi, useApiMutation } from '@/lib/api/use-api';
import { rejectUpload, formatFileSize } from '@/lib/domain/file-upload';
import { formatDate, humanize } from '@/lib/utils/format';

/*
 * PDF or image, up to 5 MB (feedback #5). The limits live in
 * `lib/domain/file-upload.ts` and are applied again by the service, and the
 * row, drop zone and viewer in DocumentParts, shared with the share papers
 * (feedback D3).
 */
const formatSize = formatFileSize;

function documentLabel(doc: ApiDocument): string {
  return doc.document_type === 'other' && doc.custom_type_name
    ? doc.custom_type_name
    : humanize(doc.document_type);
}

/**
 * What to upload, per entity.
 *
 * This panel is shared by every module, so a single line about deeds and
 * khatian copies followed a customer and an offering around, telling people to
 * upload land paperwork against an identity document. The Document Type
 * dropdown is already scoped by entity; the hint should be too.
 */
const EMPTY_HINT: Partial<Record<DocumentEntity, string>> & { default: string } = {
  project: 'Upload approved drawings, the RAJUK memo, clearances or the brochure for this project.',
  lead: 'Upload the NID copy or anything else this enquiry sent in.',
  customer: 'Upload the NID copy, photo or any identity paperwork for this customer.',
  share_offering:
    'Upload the valuation report, the board resolution approving the offer, or the offer document shown to customers.',
  share_sale: 'Upload the signed agreement or anything else filed against this purchase.',
  share_payment: 'Upload the money receipt or a copy of the cheque.',
  default: 'Upload the paperwork that belongs to this record.',
};

/**
 * Generic "Documents" tab (Section 1.1) — reused by every entity's detail page.
 * Document Type options come from `lookup_values` scoped to this entity_type.
 *
 * The file goes to the server's storage through `POST /documents` and comes
 * back by id; nothing here ever holds a path.
 */
export function DocumentsPanel({
  entityType,
  entityId,
}: {
  entityType: DocumentEntity;
  entityId: string;
}) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewing, setViewing] = useState<ApiDocument | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const documents = useApi(documentKeys.forEntity(entityType, entityId), (signal) =>
    documentsApi.listForEntity(entityType, entityId, signal),
  );
  const remove = useApiMutation((id: string) => documentsApi.remove(id), [documentKeys.all]);

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">
          {documents?.length ?? 0} document{documents?.length === 1 ? '' : 's'} · PDF, PNG, JPG or
          WEBP up to 5 MB
        </p>
        <Button
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => setUploadOpen(true)}
        >
          <Upload className="size-4" /> Upload document
        </Button>
      </div>

      {documents && documents.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents yet"
          description={EMPTY_HINT[entityType] ?? EMPTY_HINT.default}
          action={
            <Button onClick={() => setUploadOpen(true)}>
              <Upload className="size-4" /> Upload document
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2">
          {documents?.map((doc) => (
            <DocRow
              key={doc.id}
              title={doc.file_name ?? doc.external_url ?? documentLabel(doc)}
              mime={doc.mime_type}
              meta={`${documentLabel(doc)} · ${formatSize(doc.file_size)} · ${formatDate(doc.uploaded_at)}${doc.notes ? ` · ${doc.notes}` : ''}`}
              actions={
                <>
                  {WEBSITE_ENTITIES.includes(entityType) && (
                    <WebsiteToggle id={doc.id} isPublic={doc.is_public} />
                  )}
                  <Button variant="ghost" size="sm" aria-label="View document" viewSafe onClick={() => setViewing(doc)}>
                    <Eye className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="Delete document" onClick={() => setDeleteId(doc.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                </>
              }
            />
          ))}
        </ul>
      )}

      {uploadOpen && (
        <UploadDialog
          entityType={entityType}
          entityId={entityId}
          onClose={() => setUploadOpen(false)}
        />
      )}

      {viewing && (
        <DocumentViewer
          doc={viewing}
          documents={documents ?? []}
          onSelect={setViewing}
          onClose={() => setViewing(null)}
        />
      )}

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete document"
        message={
          deleteError ||
          'This removes the document from this record and deletes the uploaded file. It cannot be undone.'
        }
        confirmLabel="Delete document"
        busy={remove.isPending}
        onCancel={() => {
          setDeleteId(null);
          setDeleteError('');
        }}
        onConfirm={async () => {
          if (!deleteId) return;
          try {
            await remove.mutateAsync(deleteId);
            setDeleteId(null);
            setDeleteError('');
          } catch (error) {
            setDeleteError(messageOf(error));
          }
        }}
      />
    </>
  );
}

function UploadDialog({
  entityType,
  entityId,
  onClose,
}: {
  entityType: DocumentEntity;
  entityId: string;
  onClose: () => void;
}) {
  const [documentType, setDocumentType] = useState('');
  const [customName, setCustomName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const typeOptions = useApi(lookupKeys.category('document_type', entityType), (signal) =>
    lookupsApi.options('document_type', entityType, signal),
  );
  const upload = useApiMutation(
    (input: Parameters<typeof documentsApi.upload>[0]) => documentsApi.upload(input),
    [documentKeys.all],
  );

  function pickFile(picked: File | undefined) {
    if (!picked) return;
    const rejected = rejectUpload(picked);
    if (rejected) {
      setError(rejected);
      return;
    }
    setError('');
    setFile(picked);
  }

  async function save() {
    if (!documentType) {
      setError('Pick a document type');
      return;
    }
    if (documentType === 'other' && !customName.trim()) {
      setError('Give this document a name');
      return;
    }
    if (!file) {
      setError('Choose a file to upload');
      return;
    }

    try {
      await upload.mutateAsync({
        entity_type: entityType,
        entity_id: entityId,
        document_type: documentType,
        custom_type_name: documentType === 'other' ? customName.trim() : null,
        notes: notes.trim() || null,
        is_public: isPublic,
        file,
      });
      onClose();
    } catch (e) {
      setError(messageOf(e));
    }
  }

  return (
    <Modal
      open
      title="Upload Document"
      subtitle="PDF, PNG, JPG or WEBP up to 5 MB — kept on the server with this record."
      icon={UploadCloud}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} viewSafe disabled={upload.isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={upload.isPending}>
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Document Type" required>
          <SelectInput value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
            <option value="">Select document type…</option>
            {typeOptions?.map((o) => (
              <option key={o.id} value={o.value}>
                {humanize(o.value)}
              </option>
            ))}
          </SelectInput>
        </Field>

        {/* "Other" needs a name, otherwise the list shows a row of identical entries */}
        {documentType === 'other' && (
          <Field label="Document Name" required>
            <TextInput
              value={customName}
              placeholder="e.g. Boundary survey report"
              onChange={(e) => setCustomName(e.target.value)}
            />
          </Field>
        )}

        <FileDropZone file={file} onPick={pickFile} />

        {WEBSITE_ENTITIES.includes(entityType) && (
          <Checkbox
            label="Visible on the public website"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
          />
        )}

        <Field label="Notes">
          <TextArea
            value={notes}
            placeholder="e.g. Certified copy collected from the sub-registry office"
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** A stored document as the shared viewer reads it. */
function viewerFile(doc: ApiDocument): ViewerFile {
  return {
    id: doc.id,
    name: doc.file_name ?? doc.external_url ?? 'document',
    mime: doc.mime_type,
    subtitle: `${documentLabel(doc)} · ${formatSize(doc.file_size)} · uploaded ${formatDate(doc.uploaded_at)}`,
    load: () => (doc.has_file ? documentsApi.file(doc.id) : Promise.resolve(null)),
  };
}

/** Large preview with a sidebar to flip between the record's documents (the shared FileViewer). */
export function DocumentViewer({
  doc,
  documents,
  onSelect,
  onClose,
}: {
  doc: ApiDocument;
  documents: ApiDocument[];
  onSelect: (doc: ApiDocument) => void;
  onClose: () => void;
}) {
  const files = documents.map(viewerFile);
  return (
    <FileViewer
      file={viewerFile(doc)}
      // a single document still shows the list, as it always has
      files={files.length ? files : [viewerFile(doc)]}
      onSelect={(f) => {
        const next = documents.find((d) => d.id === f.id);
        if (next) onSelect(next);
      }}
      onClose={onClose}
    />
  );
}
