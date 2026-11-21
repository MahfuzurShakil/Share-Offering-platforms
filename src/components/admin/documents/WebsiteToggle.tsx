'use client';

import { EyeOff, Globe } from 'lucide-react';
import { documentKeys, documentsApi, type DocumentEntity } from '@/lib/api/documents';
import { useApiMutation } from '@/lib/api/use-api';
import { cn } from '@/lib/utils/cn';

/**
 * Only these records have files the public website reads (a project's gallery,
 * brochure and plans; blog pictures). Elsewhere the "public" flag would do
 * nothing, so it is not offered — and the service refuses to set it.
 */
export const WEBSITE_ENTITIES: DocumentEntity[] = ['project', 'blog_post'];

/**
 * One click puts a file on the website or takes it off (PUBLIC-WEBSITE-MASTER-PLAN
 * §10.2). Before this, `is_public` could only be chosen at upload time.
 */
export function WebsiteToggle({ id, isPublic, className }: { id: string; isPublic: boolean; className?: string }) {
  const toggle = useApiMutation(
    (next: boolean) => documentsApi.setPublic(id, next),
    [documentKeys.all],
  );
  return (
    <button
      type="button"
      aria-pressed={isPublic}
      disabled={toggle.isPending}
      title={isPublic ? 'Shown on the public website — click to hide it' : 'Internal only — click to show it on the public website'}
      onClick={(e) => {
        e.stopPropagation();
        toggle.mutate(!isPublic);
      }}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        isPublic
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
          : 'border-hairline bg-white text-ink-muted hover:border-admin-300 hover:text-admin-700',
        className,
      )}
    >
      {isPublic ? <Globe className="size-3.5" /> : <EyeOff className="size-3.5" />}
      {isPublic ? 'On website' : 'Internal'}
    </button>
  );
}
