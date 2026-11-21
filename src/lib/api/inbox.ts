'use client';

import { api } from './client';
import type { ApiShareSale } from './share-sales';

/**
 * The portal inbox: requests to buy, papers sent in, and slips.
 *
 * Method names follow the prototype's `customerPortalInbox`,
 * `customerUploadRepository` and `paymentSubmissionRepository`, so the screen
 * reads the same after the move as before it.
 */

export type ShareRequestStatus = 'new' | 'contacted' | 'reserved' | 'declined' | 'withdrawn';

export interface ApiShareRequest {
  id: string;
  code: string;
  offering_id: string;
  offering_code: string;
  offering_round: number;
  offering_status: string;
  price_per_share: number;
  project_id: string;
  project_name: string;
  /** null for a website visitor — there is no customer until one is made */
  customer_id: string | null;
  customer_code: string | null;
  /** the customer's name, or the visitor's as they typed it */
  name: string;
  phone: string | null;
  email: string | null;
  source: string;
  shares: number;
  installments: number;
  note: string | null;
  requested_at: string;
  status: ShareRequestStatus;
  sale_id: string | null;
  sale_code: string | null;
  office_note: string | null;
  /** what it would cost at the round's price */
  value: number;
  created_at: string;
  updated_at: string;
}

export type CustomerUploadStatus = 'under_review' | 'accepted' | 'rejected';

export const CUSTOMER_UPLOAD_KINDS = [
  'id_document',
  'photo',
  'tin',
  'address_proof',
  'nominee_id',
  'bank_proof',
  'signed_copy',
  'allotment_letter',
  'deed',
  'payment_proof',
  'pdc',
  'source_of_funds',
  'power_of_attorney',
  'other',
] as const;

export type CustomerUploadKind = (typeof CUSTOMER_UPLOAD_KINDS)[number];

export interface ApiCustomerUpload {
  id: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  customer_phone: string;
  sale_id: string | null;
  sale_code: string | null;
  project_name: string | null;
  source: string;
  kind: CustomerUploadKind;
  title: string;
  note: string | null;
  file_name: string;
  file_type: string;
  file_size: number;
  uploaded_at: string;
  status: CustomerUploadStatus;
  reviewed_on: string | null;
  review_note: string | null;
}

export type OfflinePaymentMethod =
  | 'bank_deposit'
  | 'bank_transfer'
  | 'cheque_deposit'
  | 'pay_order';

export type PaymentSubmissionStatus = 'submitted' | 'confirmed' | 'rejected' | 'withdrawn';

export interface ApiPaymentSubmission {
  id: string;
  code: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  customer_phone: string;
  sale_id: string;
  sale_code: string;
  project_name: string;
  amount: number;
  method: OfflinePaymentMethod;
  paid_on: string;
  paid_into_account_id: string | null;
  account_name: string | null;
  reference: string;
  note: string | null;
  slip_upload_id: string | null;
  status: PaymentSubmissionStatus;
  reviewed_at: string | null;
  review_note: string | null;
  payment_id: string | null;
  /** the receipt its confirmation wrote */
  receipt_no: string | null;
  created_at: string;
}

export interface ApiInboxCounts {
  requests_new: number;
  requests_value: number;
  uploads_waiting: number;
  submissions_waiting: number;
  submissions_value: number;
}

export const OFFLINE_METHOD_LABEL: Record<OfflinePaymentMethod, string> = {
  bank_deposit: 'Cash deposit at the bank',
  bank_transfer: 'Bank transfer',
  cheque_deposit: 'Cheque deposited',
  pay_order: 'Pay order',
};

export const UPLOAD_KIND_LABEL: Record<CustomerUploadKind, string> = {
  id_document: 'NID or passport',
  photo: 'Photograph',
  tin: 'e-TIN',
  address_proof: 'Address proof',
  nominee_id: 'Nominee’s NID',
  bank_proof: 'Bank proof',
  signed_copy: 'Signed agreement',
  allotment_letter: 'Allotment letter',
  deed: 'Deed',
  payment_proof: 'Payment slip',
  pdc: 'Post-dated cheques',
  source_of_funds: 'Source of funds',
  power_of_attorney: 'Power of attorney',
  other: 'Other',
};

export const requestsApi = {
  list(
    query: { status?: ShareRequestStatus; offering_id?: string; customer_id?: string } = {},
    signal?: AbortSignal,
  ) {
    return api.get<ApiShareRequest[]>('/share-requests', { ...query }, signal);
  },

  create(input: {
    offering_id: string;
    customer_id?: string | null;
    prospect_name?: string | null;
    prospect_phone?: string | null;
    prospect_email?: string | null;
    shares: number;
    installments?: number;
    note?: string | null;
    source?: 'portal' | 'website';
  }) {
    return api.post<ApiShareRequest>('/share-requests', input);
  },

  /** A note about the call, a decline, or putting it back in the queue. */
  move(id: string, action: 'contacted' | 'declined' | 'reopen', office_note?: string | null) {
    return api.patch<ApiShareRequest>(`/share-requests/${id}`, { action, office_note });
  },

  /** The step that holds shares: the request becomes a purchase. */
  reserve(
    id: string,
    input: {
      customer_id?: string;
      shares?: number;
      down_payment_pct: number;
      installment_count: number;
      sold_by_member_id?: string | null;
    },
  ) {
    return api.patch<{ request: ApiShareRequest; sale: ApiShareSale }>(`/share-requests/${id}`, {
      action: 'reserve',
      ...input,
    });
  },
};

export const uploadsApi = {
  list(
    query: { status?: CustomerUploadStatus; customer_id?: string; sale_id?: string } = {},
    signal?: AbortSignal,
  ) {
    return api.get<ApiCustomerUpload[]>('/customer-uploads', { ...query }, signal);
  },

  upload(input: {
    customer_id: string;
    sale_id?: string | null;
    kind: CustomerUploadKind;
    title: string;
    note?: string | null;
    source?: 'customer' | 'office';
    file: File;
  }) {
    const form = new FormData();
    form.set('customer_id', input.customer_id);
    if (input.sale_id) form.set('sale_id', input.sale_id);
    form.set('kind', input.kind);
    form.set('title', input.title);
    if (input.note) form.set('note', input.note);
    if (input.source) form.set('source', input.source);
    form.set('file', input.file);
    return api.upload<ApiCustomerUpload>('/customer-uploads', form);
  },

  accept(id: string) {
    return api.patch<ApiCustomerUpload>(`/customer-uploads/${id}`, { action: 'accept' });
  },

  reject(id: string, review_note: string) {
    return api.patch<ApiCustomerUpload>(`/customer-uploads/${id}`, {
      action: 'reject',
      review_note,
    });
  },

  file(id: string, signal?: AbortSignal) {
    return api.blob(`/customer-uploads/${id}/file`, signal);
  },
};

/** The path an `<img>` or a download link can point straight at. */
export function uploadFileUrl(id: string): string {
  return `/api/v1/customer-uploads/${id}/file`;
}

export const submissionsApi = {
  list(
    query: { status?: PaymentSubmissionStatus; customer_id?: string; sale_id?: string } = {},
    signal?: AbortSignal,
  ) {
    return api.get<ApiPaymentSubmission[]>('/payment-submissions', { ...query }, signal);
  },

  /** The four numbers across the top of the screen. */
  counts(signal?: AbortSignal) {
    return api.get<ApiInboxCounts>('/payment-submissions', { counts: 'true' }, signal);
  },

  create(input: {
    customer_id: string;
    sale_id: string;
    amount: number;
    method: OfflinePaymentMethod;
    paid_on: string;
    reference: string;
    paid_into_account_id?: string | null;
    note?: string | null;
    slip_upload_id?: string | null;
  }) {
    return api.post<ApiPaymentSubmission>('/payment-submissions', input);
  },

  /** Found on the statement: writes the receipt, dated the day on the slip. */
  confirm(
    id: string,
    input: {
      amount?: number;
      paid_on?: string;
      account_id?: string | null;
      note?: string | null;
    } = {},
  ) {
    return api.patch<ApiPaymentSubmission>(`/payment-submissions/${id}`, {
      action: 'confirm',
      ...input,
    });
  },

  reject(id: string, review_note: string) {
    return api.patch<ApiPaymentSubmission>(`/payment-submissions/${id}`, {
      action: 'reject',
      review_note,
    });
  },
};

export const inboxKeys = {
  all: ['inbox'] as const,
  requests: (query: object = {}) => ['inbox', 'requests', query] as const,
  uploads: (query: object = {}) => ['inbox', 'uploads', query] as const,
  submissions: (query: object = {}) => ['inbox', 'submissions', query] as const,
  counts: ['inbox', 'counts'] as const,
};
