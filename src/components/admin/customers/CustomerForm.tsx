'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, TextArea, TextInput } from '@/components/ui/Field';
import { fieldErrorsOf, messageOf } from '@/lib/api/client';
import { customerKeys, customersApi, type ApiCustomer } from '@/lib/api/customers';
import { useApi, useRefresh } from '@/lib/api/use-api';
import { isMobile, normalizePhone } from '@/lib/domain/phone';

interface FormState {
  name: string;
  phone: string;
  email: string;
  nid: string;
  tin: string;
  date_of_birth: string;
  father_or_spouse_name: string;
  profession: string;
  address: string;
  permanent_address: string;
  nominee_name: string;
  nominee_relation: string;
  nominee_phone: string;
  nominee_nid: string;
  bank_name: string;
  bank_branch: string;
  bank_account: string;
}

const EMPTY: FormState = {
  name: '',
  phone: '',
  email: '',
  nid: '',
  tin: '',
  date_of_birth: '',
  father_or_spouse_name: '',
  profession: '',
  address: '',
  permanent_address: '',
  nominee_name: '',
  nominee_relation: '',
  nominee_phone: '',
  nominee_nid: '',
  bank_name: '',
  bank_branch: '',
  bank_account: '',
};

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/**
 * Add / edit an investor.
 *
 * Three cards, in the order the office actually fills them: who they are, what
 * the agreement will need about them, and where their money goes. Only the
 * name and the number are required — the office meets somebody long before it
 * has their e-TIN, and a form that will not save without it is a form people
 * work around. What is needed *to sign* is checked at the signing
 * (PROJECT-SHARE-SALE-PLAN.md §4a).
 *
 * One investor, one phone number: somebody holding shares in two projects is
 * one file with two purchases. The number is checked as it is typed, and the
 * server refuses a duplicate even if two people type it at once.
 */
export function CustomerForm({ customer }: { customer?: ApiCustomer }) {
  const router = useRouter();
  const refresh = useRefresh([customerKeys.all]);

  const [form, setForm] = useState<FormState>(customer ? toFormState(customer) : EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const typedPhone = normalizePhone(form.phone);
  const match = useApi(
    customerKeys.byPhone(typedPhone),
    (signal) => customersApi.byPhone(typedPhone, signal),
    { enabled: isMobile(typedPhone) },
  );
  const duplicate = match && match.id !== customer?.id ? match : null;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors({});
  };

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = 'Name is required';
    if (!form.phone.trim()) next.phone = 'Phone is required';
    else if (!isMobile(form.phone)) next.phone = 'Enter a full 11-digit number';
    else if (duplicate) next.phone = `${duplicate.code} already uses this number`;
    if (form.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) {
      next.email = 'Enter a valid email address';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        phone: normalizePhone(form.phone),
        email: form.email.trim() || null,
        nid: form.nid.trim() || null,
        tin: form.tin.trim() || null,
        date_of_birth: form.date_of_birth || null,
        father_or_spouse_name: form.father_or_spouse_name.trim() || null,
        profession: form.profession.trim() || null,
        address: form.address.trim() || null,
        permanent_address: form.permanent_address.trim() || null,
        nominee_name: form.nominee_name.trim() || null,
        nominee_relation: form.nominee_relation.trim() || null,
        nominee_phone: form.nominee_phone.trim() || null,
        nominee_nid: form.nominee_nid.trim() || null,
        bank_name: form.bank_name.trim() || null,
        bank_branch: form.bank_branch.trim() || null,
        bank_account: form.bank_account.trim() || null,
      };

      const saved = customer
        ? await customersApi.update(customer.id, payload)
        : await customersApi.create(payload);

      await refresh();
      router.push(`/admin/customers/${saved.id}`);
    } catch (err) {
      setErrors({ ...fieldErrorsOf(err), form: messageOf(err) });
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 pb-4">
      <Card>
        <CardHeader title="1. Who they are" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Name" required error={errors.name}>
            <TextInput
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Kamrul Hasan Chowdhury"
              invalid={Boolean(errors.name)}
            />
          </Field>
          <Field label="Mobile number" required error={errors.phone}>
            <TextInput
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="e.g. 01711 223344"
              invalid={Boolean(errors.phone)}
            />
          </Field>
          <Field label="Email" error={errors.email}>
            <TextInput
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="e.g. kamrul@example.com"
              invalid={Boolean(errors.email)}
            />
          </Field>
          <Field label="Profession" error={errors.profession}>
            <TextInput
              value={form.profession}
              onChange={(e) => set('profession', e.target.value)}
              placeholder="e.g. Businessman, Doctor, Service holder"
            />
          </Field>
          <Field label="Date of birth" error={errors.date_of_birth}>
            <TextInput
              type="date"
              value={form.date_of_birth}
              onChange={(e) => set('date_of_birth', e.target.value)}
            />
          </Field>
          <Field label="Present address" className="md:col-span-2 xl:col-span-3">
            <TextArea
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              placeholder="Where they live now"
            />
          </Field>
        </div>

        {duplicate && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="flex items-start gap-2 text-sm font-medium text-amber-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {duplicate.code} — {duplicate.name} already uses this number
            </p>
            <p className="mt-1 text-xs text-amber-700">
              One investor, one number. Open that record and add the new purchase there, so their
              holdings and papers stay together.
            </p>
            <Link href={`/admin/customers/${duplicate.id}`} className="mt-3 inline-block">
              <Button variant="outline" size="sm">
                Open {duplicate.code}
              </Button>
            </Link>
          </div>
        )}
      </Card>

      {/*
        What the agreement names (plan §4a). Kept on the customer, once, so it
        serves every purchase they ever make rather than being retyped at each
        signing.
      */}
      <Card>
        <CardHeader
          title="2. What the agreement will need"
          subtitle="Filled in by the signing, not before it. Nothing here is required to save the record."
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="NID or passport number" error={errors.nid}>
            <TextInput
              value={form.nid}
              onChange={(e) => set('nid', e.target.value)}
              placeholder="e.g. 1990123456789"
            />
          </Field>
          <Field label="e-TIN" error={errors.tin}>
            <TextInput value={form.tin} onChange={(e) => set('tin', e.target.value)} />
          </Field>
          <Field
            label="Father’s or spouse’s name"
            error={errors.father_or_spouse_name}
            hint="As agreements name a person"
          >
            <TextInput
              value={form.father_or_spouse_name}
              onChange={(e) => set('father_or_spouse_name', e.target.value)}
            />
          </Field>
          <Field label="Permanent address" className="md:col-span-2 xl:col-span-3">
            <TextArea
              value={form.permanent_address}
              onChange={(e) => set('permanent_address', e.target.value)}
              placeholder="As on the NID"
            />
          </Field>

          <Field label="Nominee" error={errors.nominee_name}>
            <TextInput
              value={form.nominee_name}
              onChange={(e) => set('nominee_name', e.target.value)}
              placeholder="Who inherits the shares"
            />
          </Field>
          <Field label="Nominee’s relation" error={errors.nominee_relation}>
            <TextInput
              value={form.nominee_relation}
              onChange={(e) => set('nominee_relation', e.target.value)}
              placeholder="e.g. Son, Wife, Brother"
            />
          </Field>
          <Field label="Nominee’s mobile" error={errors.nominee_phone}>
            <TextInput
              value={form.nominee_phone}
              onChange={(e) => set('nominee_phone', e.target.value)}
            />
          </Field>
          <Field label="Nominee’s NID" error={errors.nominee_nid}>
            <TextInput
              value={form.nominee_nid}
              onChange={(e) => set('nominee_nid', e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="3. Where their money goes"
          subtitle="The account a profit share or a refund is sent to."
        />
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Bank" error={errors.bank_name}>
            <TextInput
              value={form.bank_name}
              onChange={(e) => set('bank_name', e.target.value)}
              placeholder="e.g. BRAC Bank"
            />
          </Field>
          <Field label="Branch" error={errors.bank_branch}>
            <TextInput
              value={form.bank_branch}
              onChange={(e) => set('bank_branch', e.target.value)}
              placeholder="e.g. Gulshan"
            />
          </Field>
          <Field label="Account number" error={errors.bank_account}>
            <TextInput
              value={form.bank_account}
              onChange={(e) => set('bank_account', e.target.value)}
            />
          </Field>
        </div>

        <p className="mt-4 flex items-start gap-2 text-xs text-ink-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          NID, photo and bank proof are uploaded on the customer&apos;s Documents tab after saving.
        </p>
      </Card>

      {errors.form && <p className="text-right text-sm text-red-600">{errors.form}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || Boolean(duplicate)}>
          {saving ? 'Saving…' : customer ? 'Save changes' : 'Create customer'}
        </Button>
      </div>
    </form>
  );
}

function toFormState(customer: ApiCustomer): FormState {
  return {
    name: customer.name,
    phone: customer.phone,
    email: str(customer.email),
    nid: str(customer.nid),
    tin: str(customer.tin),
    date_of_birth: str(customer.date_of_birth),
    father_or_spouse_name: str(customer.father_or_spouse_name),
    profession: str(customer.profession),
    address: str(customer.address),
    permanent_address: str(customer.permanent_address),
    nominee_name: str(customer.nominee_name),
    nominee_relation: str(customer.nominee_relation),
    nominee_phone: str(customer.nominee_phone),
    nominee_nid: str(customer.nominee_nid),
    bank_name: str(customer.bank_name),
    bank_branch: str(customer.bank_branch),
    bank_account: str(customer.bank_account),
  };
}
