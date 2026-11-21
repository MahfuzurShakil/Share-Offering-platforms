'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Image as ImageIcon, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Checkbox, Field, SelectInput, TextArea, TextInput } from '@/components/ui/Field';
import { useBlobUrl } from '@/components/ui/useBlobUrl';
import { fieldErrorsOf, messageOf } from '@/lib/api/client';
import {
  assignableUserKeys,
  assignableUsersApi,
  projectKeys,
  projectsApi,
  type ApiProject,
} from '@/lib/api/projects';
import { documentFileUrl, documentsApi } from '@/lib/api/documents';
import { lookupKeys, lookupsApi } from '@/lib/api/lookups';
import { useApi, useRefresh } from '@/lib/api/use-api';

interface FormState {
  name: string;
  description: string;
  project_type: ApiProject['project_type'];
  income_type: ApiProject['income_type'];
  expected_hold_months: string;
  location_summary: string;
  project_manager: string;
  construction_after_sale: ApiProject['construction_after_sale'];
  surroundings: string;
}

/**
 * What kind of thing is being sold in shares.
 *
 * Every project in this build is sold as shares, so the picker was left out at
 * first — but what the shares are *of* is the first line of any listing, and
 * the column was already there, defaulting everything to land.
 */
const PROJECT_TYPE_OPTIONS: Record<ApiProject['project_type'], string> = {
  land_share: 'Land held as shares',
  plot_development: 'Plot development',
  apartment: 'Apartment building',
  commercial: 'Commercial building',
  mixed: 'Mixed use',
};

/**
 * Where the money comes from.
 *
 * On every fractional-investment listing worth reading this sits next to the
 * price, because it is what the investor is actually buying: rent, a resale,
 * or a business run on the asset. The profit-sharing module books income
 * against it (REVENUE-SHARE-PLAN.md).
 */
const INCOME_TYPE_LABEL: Record<ApiProject['income_type'], string> = {
  rent: 'Rent or lease income',
  resale: 'Selling the land or the units on',
  operation: 'A business run on it — hotel, market, warehouse',
  mixed: 'More than one of these',
  undecided: 'Not decided yet',
};

/**
 * What happens to the land once its shares are sold.
 *
 * An investor's first question after "what do I own" — the answer changes
 * whether they are buying land that sits, or land that becomes a building.
 * Already a column on the project; it was never on the form.
 */
const AFTER_SALE_LABEL: Record<ApiProject['construction_after_sale'], string> = {
  undecided: 'Not decided yet',
  planned: 'Construction planned for the shareholders',
  none: 'No construction — the land stays as shares',
};

const EMPTY: FormState = {
  name: '',
  description: '',
  project_type: 'land_share',
  income_type: 'undecided',
  expected_hold_months: '',
  location_summary: '',
  project_manager: '',
  construction_after_sale: 'undecided',
  surroundings: '',
};

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function toFormState(p: ApiProject): FormState {
  return {
    name: p.name,
    description: str(p.description),
    project_type: p.project_type,
    income_type: p.income_type,
    expected_hold_months: str(p.expected_hold_months),
    location_summary: str(p.location_summary),
    project_manager: str(p.project_manager_id),
    construction_after_sale: p.construction_after_sale,
    surroundings: str(p.surroundings),
  };
}

/**
 * Add / Edit project — Phase 1 (share-sale build).
 *
 * A project here is the thing shares are sold in: what it is called, where it
 * is, how big the land is, the selling window, and what the website shows.
 * Land is a fact typed on the project, not a record picked from a Land
 * module: this build has no land acquisition, so there is nothing to pick.
 * When Phase 2 brings the Land module back, this field becomes the link and
 * the area is read from the land again.
 *
 * Also not here, on purpose: the project type picker (every project in this
 * product is sold as shares), the construction and development timelines, the
 * architect, and the amenity list for a building that is not being built.
 */
export function ProjectForm({ project }: { project?: ApiProject }) {
  const router = useRouter();

  const refresh = useRefresh([projectKeys.all]);
  const [form, setForm] = useState<FormState>(project ? toFormState(project) : EMPTY);
  const managers =
    useApi(assignableUserKeys.all, (signal) => assignableUsersApi.list(signal)) ?? [];
  const [amenities, setAmenities] = useState<string[]>(project?.amenities ?? []);
  const amenityOptions = (
    useApi(lookupKeys.category('amenity'), (signal) => lookupsApi.options('amenity', null, signal)) ??
    []
  ).map((row) => row.value);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  /** the display picture, uploaded rather than linked (client feedback 2026-10-11) */
  const [coverFile, setCoverFile] = useState<File | null>(null);
  /*
   * The picture already on the project is served by the API behind its own
   * permission check; a freshly picked file has not been uploaded yet, so that
   * one is previewed from the browser's own copy.
   */
  const pickedPreview = useBlobUrl(coverFile);
  const coverPreview =
    pickedPreview ??
    (project?.cover_image_document_id
      ? documentFileUrl(project.cover_image_document_id)
      : (project?.cover_image_url ?? null));

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  /*
   * Two projects with one name are two answers to "which one?" (QA 2026-10-11)
   * — the check is the server's now: it holds against a save made in another
   * tab, which a list loaded into this browser never could. It comes back as a
   * field error on `name`.
   */

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = 'Project name is required';
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
        description: form.description.trim() || null,
        project_type: form.project_type,
        income_type: form.income_type,
        expected_hold_months: form.expected_hold_months.trim()
          ? Number(form.expected_hold_months)
          : null,
        location_summary: form.location_summary.trim() || null,
        project_manager_id: form.project_manager || null,
        construction_after_sale: form.construction_after_sale,
        surroundings: form.surroundings.trim() || null,
        amenities,
      };

      const saved: ApiProject = project
        ? await projectsApi.update(project.id, payload)
        : await projectsApi.create(payload);

      /*
       * The picture is a document of the project like any other, so it is
       * uploaded through the documents API and the project is then pointed at
       * it. It is marked public because a display picture is, by definition,
       * the one the website leads with.
       */
      if (coverFile) {
        const doc = await documentsApi.upload({
          entity_type: 'project',
          entity_id: saved.id,
          document_type: 'gallery_image',
          is_public: true,
          notes: 'Display picture, uploaded with the project',
          file: coverFile,
        });
        await projectsApi.update(saved.id, {
          cover_image_document_id: doc.id,
          cover_image_url: null,
        });
      }

      /*
       * The list and the detail screen are now server data, so they are told
       * to refetch rather than being left with what they had.
       */
      await refresh();
      router.push(`/admin/projects/${saved.id}`);
    } catch (err) {
      // QA audit P-08 — a failure is said, not swallowed, and the server's own
      // field errors land beside the inputs they are about
      setErrors((prev) => ({ ...prev, ...fieldErrorsOf(err), form: messageOf(err) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 pb-4">
      {/* 1 — what the project is */}
      <Card>
        <CardHeader title="Project information" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Project name" required error={errors.name} className="xl:col-span-2">
            <TextInput
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Green Court"
              invalid={Boolean(errors.name)}
            />
          </Field>
          <Field label="What is being sold in shares" required>
            <SelectInput
              value={form.project_type}
              onChange={(e) => set('project_type', e.target.value as FormState['project_type'])}
            >
              {(Object.keys(PROJECT_TYPE_OPTIONS) as FormState['project_type'][]).map((k) => (
                <option key={k} value={k}>
                  {PROJECT_TYPE_OPTIONS[k]}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Project manager">
            <SelectInput
              value={form.project_manager}
              onChange={(e) => set('project_manager', e.target.value)}
            >
              <option value="">Not assigned</option>
              {managers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field
            label="Location summary"
            className="xl:col-span-3"
            hint="The address the public site shows."
          >
            <TextInput
              value={form.location_summary}
              onChange={(e) => set('location_summary', e.target.value)}
              placeholder="e.g. Bashundhara R/A, Dhaka"
            />
          </Field>
          {/*
            What this project is, in the words an investor reads before they
            decide. The public listing and the offer document both need it, and
            nothing else on the project said it.
          */}
          <Field
            label="About this project"
            className="xl:col-span-3"
            hint="A few sentences: what it is, where it is, why somebody would buy a share of it."
          >
            <TextArea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="e.g. A five-storey commercial plot on the Bashundhara main road, held for rental income while the area develops."
              rows={4}
            />
          </Field>
        </div>
      </Card>

      {/* 2 — the land it stands on, and the selling window */}
      <Card>
        <CardHeader
          title="What an investor is buying"
          subtitle="Where the money comes from, how long they should expect to hold, and what happens to the land once its shares are sold. When shares go on sale, and for how long, belongs to each share offering."
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field
            label="How this project earns"
            className="md:col-span-2"
            hint="What the shareholders' profit will be shared out of."
          >
            <SelectInput
              value={form.income_type}
              onChange={(e) => set('income_type', e.target.value as FormState['income_type'])}
            >
              {(Object.keys(INCOME_TYPE_LABEL) as FormState['income_type'][]).map((k) => (
                <option key={k} value={k}>
                  {INCOME_TYPE_LABEL[k]}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field
            label="Expected holding period"
            className="md:col-span-2"
            hint="In months. Leave it empty if the shares are open-ended."
          >
            <TextInput
              type="number"
              min="0"
              max="600"
              step="1"
              value={form.expected_hold_months}
              onChange={(e) => set('expected_hold_months', e.target.value)}
              placeholder="e.g. 36"
            />
          </Field>
          <Field
            label="After the shares are sold"
            className="md:col-span-2"
            hint="What an investor is buying into: land that sits, or land that becomes a building."
          >
            <SelectInput
              value={form.construction_after_sale}
              onChange={(e) =>
                set('construction_after_sale', e.target.value as FormState['construction_after_sale'])
              }
            >
              {(Object.keys(AFTER_SALE_LABEL) as FormState['construction_after_sale'][]).map((k) => (
                <option key={k} value={k}>
                  {AFTER_SALE_LABEL[k]}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
      </Card>

      {/* 3 — what investors see */}
      <Card>
        <CardHeader title="Amenities & surroundings" />
        {amenityOptions.length > 0 && (
          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {amenityOptions.map((option) => (
              <Checkbox
                key={option}
                label={option}
                checked={amenities.includes(option)}
                onChange={() =>
                  setAmenities((list) =>
                    list.includes(option) ? list.filter((a) => a !== option) : [...list, option],
                  )
                }
              />
            ))}
          </div>
        )}
        <Field label="Surroundings" hint="School, hospital, market, main road distances">
          <TextArea
            value={form.surroundings}
            onChange={(e) => set('surroundings', e.target.value)}
            placeholder="e.g. Scholastica 900m, Evercare Hospital 2km, 100ft road 300m"
          />
        </Field>
      </Card>

      {/* 4 — the display picture, on its own line (client feedback 2026-10-11) */}
      <Card>
        <CardHeader
          title="Project picture"
          subtitle="Shown on the project list and the public website. More photos go on the Documents tab."
        />
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid size-28 shrink-0 place-items-center overflow-hidden rounded-xl border border-hairline bg-slate-50">
            {coverPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverPreview} alt="Project picture" className="size-full object-cover" />
            ) : (
              <ImageIcon className="size-8 text-slate-300" />
            )}
          </div>
          <div className="space-y-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-hairline bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-admin-50">
              <Upload className="size-4" />
              {coverPreview ? 'Replace picture' : 'Upload picture'}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <p className="text-xs text-ink-muted">
              {coverFile ? coverFile.name : 'JPG or PNG. Publishing is on the Sales card.'}
            </p>
          </div>
        </div>
      </Card>

      {errors.form && <p className="text-right text-sm text-red-600">{errors.form}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : project ? 'Save changes' : 'Create project'}
        </Button>
      </div>
    </form>
  );
}
