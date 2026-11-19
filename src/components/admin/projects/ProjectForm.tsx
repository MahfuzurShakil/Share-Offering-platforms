'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { Image as ImageIcon, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Checkbox, Field, SelectInput, TextArea, TextInput } from '@/components/ui/Field';
import { useBlobUrl } from '@/components/ui/useBlobUrl';
import { LAND_SIZE_UNITS, type LandSizeUnit } from '@/lib/db/types';
import { LAND_SIZE_UNIT_LABEL } from '@/lib/domain/land';
import { fieldErrorsOf, messageOf } from '@/lib/api/client';
import {
  assignableUserKeys,
  assignableUsersApi,
  projectKeys,
  projectsApi,
  type ApiProject,
} from '@/lib/api/projects';
import { useApi, useRefresh } from '@/lib/api/use-api';
import { documentRepository, lookupRepository } from '@/lib/repositories';

interface FormState {
  name: string;
  description: string;
  location_summary: string;
  total_land_area: string;
  total_land_area_unit: LandSizeUnit;
  project_manager: string;
  construction_after_sale: ApiProject['construction_after_sale'];
  surroundings: string;
}

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
  location_summary: '',
  total_land_area: '',
  total_land_area_unit: 'katha',
  project_manager: '',
  construction_after_sale: 'undecided',
  surroundings: '',
};

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function toFormState(p: ApiProject): FormState {
  return {
    name: p.name,
    description: str(p.description),
    location_summary: str(p.location_summary),
    total_land_area: str(p.total_land_area),
    total_land_area_unit: p.total_land_area_unit ?? 'katha',
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
  const [amenityOptions, setAmenityOptions] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  /** the display picture, uploaded rather than linked (client feedback 2026-10-11) */
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const currentCover = useLiveQuery(
    () =>
      project?.cover_image_document_id
        ? documentRepository.getById(project.cover_image_document_id)
        : Promise.resolve(undefined),
    [project?.cover_image_document_id],
  );
  const coverPreview = useBlobUrl(coverFile ?? currentCover?.file_data ?? null);

  useEffect(() => {
    lookupRepository.options('amenity').then((rows) => setAmenityOptions(rows.map((r) => r.value)));
  }, []);

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
    if (form.total_land_area.trim() && !(Number(form.total_land_area) > 0)) {
      next.total_land_area = 'Enter the area as a number, or leave it blank';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const area = form.total_land_area.trim() ? Number(form.total_land_area) : null;
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        location_summary: form.location_summary.trim() || null,
        total_land_area: area,
        total_land_area_unit: area === null ? null : form.total_land_area_unit,
        project_manager_id: form.project_manager || null,
        construction_after_sale: form.construction_after_sale,
        surroundings: form.surroundings.trim() || null,
        amenities,
      };

      const saved: ApiProject = project
        ? await projectsApi.update(project.id, payload)
        : await projectsApi.create(payload);

      /*
       * The picture is still an interim Dexie document — file storage is S4 —
       * so the file is kept there and only the reference to it goes to the
       * project over the API.
       */
      if (coverFile) {
        const doc = await documentRepository.create({
          entity_type: 'project',
          entity_id: saved.id,
          document_type: 'gallery_image',
          custom_type_name: null,
          file_url: coverFile.name,
          file_data: coverFile,
          file_name: coverFile.name,
          file_size: coverFile.size,
          mime_type: coverFile.type,
          is_public: true,
          uploaded_by: null,
          uploaded_at: new Date().toISOString(),
          notes: 'Display picture, uploaded with the project',
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
          title="The land, and what happens to it"
          subtitle="The land is a fact about the project here; buying land is not part of this phase. When shares go on sale, and for how long, belongs to each share offering."
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Total land area" error={errors.total_land_area} hint="Optional">
            <TextInput
              inputMode="decimal"
              value={form.total_land_area}
              onChange={(e) => set('total_land_area', e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="e.g. 12.5"
              invalid={Boolean(errors.total_land_area)}
            />
          </Field>
          <Field label="Unit">
            <SelectInput
              value={form.total_land_area_unit}
              onChange={(e) => set('total_land_area_unit', e.target.value as LandSizeUnit)}
            >
              {LAND_SIZE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {LAND_SIZE_UNIT_LABEL[u]}
                </option>
              ))}
            </SelectInput>
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
