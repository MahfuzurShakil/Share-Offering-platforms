'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, SelectInput, TextArea, TextInput } from '@/components/ui/Field';
import { fieldErrorsOf, messageOf } from '@/lib/api/client';
import { leadKeys, leadsApi, salesTeamApi, salesTeamKeys, type ApiLeadDetail } from '@/lib/api/leads';
import { projectKeys, projectsApi } from '@/lib/api/projects';
import { useApi, useRefresh } from '@/lib/api/use-api';
import { BUDGET_RANGE_OPTIONS, LEAD_SOURCES, type LeadSource } from '@/lib/db/types';
import { LEAD_SOURCE_LABEL } from '@/lib/domain/lead';
import { isMobile, normalizePhone } from '@/lib/domain/phone';

interface FormState {
  name: string;
  phone: string;
  email: string;
  source: LeadSource;
  inquiry_message: string;
  interested_project_id: string;
  budget_range: string;
  assigned_to: string;
}

const EMPTY: FormState = {
  name: '',
  phone: '',
  email: '',
  source: 'walk_in',
  inquiry_message: '',
  interested_project_id: '',
  budget_range: '',
  assigned_to: '',
};

const PROJECT_PICKER = { page_size: 200, sort: 'name' as const };

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/**
 * Add / Edit form for the CRM module (Design Reference A.9).
 *
 * On a new lead the number is checked against the existing ones as it is typed
 * — it is the dedup key (Scope v3 §4.5), so a repeat caller must land on their
 * own lead as an activity rather than becoming a second row. The warning here
 * is a courtesy; the server is what actually decides, and it answers with
 * `merged` saying which of the two happened.
 */
export function LeadForm({ lead }: { lead?: ApiLeadDetail }) {
  const router = useRouter();
  const refresh = useRefresh([leadKeys.all]);
  const isEdit = Boolean(lead);

  const [form, setForm] = useState<FormState>(lead ? toFormState(lead) : EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const projects = useApi(projectKeys.list(PROJECT_PICKER), (signal) =>
    projectsApi.list(PROJECT_PICKER, signal),
  );
  const salesTeam = useApi(salesTeamKeys.all, (signal) => salesTeamApi.list(signal));

  const typedPhone = normalizePhone(form.phone);
  const match = useApi(
    leadKeys.byPhone(typedPhone),
    (signal) => leadsApi.byPhone(typedPhone, signal),
    { enabled: isMobile(typedPhone) },
  );
  const duplicate = match && match.id !== lead?.id ? match : null;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors({});
  };

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = 'Name is required';
    if (!form.phone.trim()) next.phone = 'Phone is required';
    else if (!isMobile(form.phone)) next.phone = 'Enter a full 11-digit number';
    // on an edit a clash is an error; on a new lead it is a merge, which is fine
    else if (duplicate && isEdit) next.phone = `${duplicate.code} already uses this number`;
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
        source: form.source,
        inquiry_message: form.inquiry_message.trim() || null,
        interested_project_id: form.interested_project_id || null,
        budget_range: form.budget_range || null,
        assigned_to: form.assigned_to || null,
      };

      if (lead) {
        await leadsApi.update(lead.id, payload);
        await refresh();
        router.push(`/admin/leads/${lead.id}`);
        return;
      }

      // dedup lives on the server, so the public enquiry form gets the same rule
      const { lead: saved } = await leadsApi.capture(payload);
      await refresh();
      router.push(`/admin/leads/${saved.id}`);
    } catch (err) {
      setErrors({ ...fieldErrorsOf(err), form: messageOf(err) });
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 pb-4">
      <Card>
        <CardHeader title="Buyer" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Name" required error={errors.name}>
            <TextInput
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Tanvir Hasan"
              invalid={Boolean(errors.name)}
            />
          </Field>
          <Field
            label="Phone"
            required
            error={errors.phone}
            hint={isEdit ? undefined : 'Checked against existing leads as you type.'}
          >
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
              placeholder="e.g. tanvir@example.com"
              invalid={Boolean(errors.email)}
            />
          </Field>
        </div>

        {duplicate && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="flex items-start gap-2 text-sm font-medium text-amber-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              This number already belongs to {duplicate.code} — {duplicate.name}
            </p>
            <p className="mt-1 text-xs text-amber-700">
              {isEdit
                ? 'Two leads cannot share a number. Open that lead instead, or correct this one.'
                : 'Saving will not create a second lead. The inquiry is added to that lead as an activity, so the whole conversation stays in one place.'}
            </p>
            <Link href={`/admin/leads/${duplicate.id}`} className="mt-3 inline-block">
              <Button variant="outline" size="sm">
                Open {duplicate.code}
              </Button>
            </Link>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Inquiry" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Source" required>
            <SelectInput
              value={form.source}
              onChange={(e) => set('source', e.target.value as LeadSource)}
            >
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_SOURCE_LABEL[s]}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Budget Range">
            <SelectInput
              value={form.budget_range}
              onChange={(e) => set('budget_range', e.target.value)}
            >
              <option value="">Not stated</option>
              {BUDGET_RANGE_OPTIONS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Assigned To" hint="Sales Executive who owns the follow-up.">
            <SelectInput
              value={form.assigned_to}
              onChange={(e) => set('assigned_to', e.target.value)}
            >
              <option value="">Unassigned</option>
              {(salesTeam ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </SelectInput>
          </Field>

          <Field label="Interested Project">
            <SelectInput
              value={form.interested_project_id}
              onChange={(e) => set('interested_project_id', e.target.value)}
            >
              <option value="">Not decided</option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </SelectInput>
          </Field>

          <Field label="Inquiry Message" className="md:col-span-2 xl:col-span-3">
            <TextArea
              value={form.inquiry_message}
              onChange={(e) => set('inquiry_message', e.target.value)}
              placeholder="What the buyer asked for, in their own words"
            />
          </Field>
        </div>
      </Card>

      {errors.form && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {errors.form}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving
            ? 'Saving…'
            : isEdit
              ? 'Save changes'
              : duplicate
                ? 'Add to existing lead'
                : 'Create lead'}
        </Button>
      </div>
    </form>
  );
}

function toFormState(lead: ApiLeadDetail): FormState {
  return {
    ...EMPTY,
    name: lead.name,
    phone: lead.phone,
    email: str(lead.email),
    source: lead.source,
    inquiry_message: str(lead.inquiry_message),
    interested_project_id: str(lead.interested_project_id),
    budget_range: str(lead.budget_range),
    assigned_to: str(lead.assigned_to),
  };
}
