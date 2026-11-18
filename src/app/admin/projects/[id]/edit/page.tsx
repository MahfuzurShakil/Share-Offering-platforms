'use client';

import { useParams } from 'next/navigation';
import { ProjectForm } from '@/components/admin/projects/ProjectForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { projectKeys, projectsApi } from '@/lib/api/projects';
import { useApiQuery } from '@/lib/api/use-api';

export default function EditProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { data: project, isPending, isError } = useApiQuery(projectKeys.one(id), (signal) =>
    projectsApi.get(id, signal),
  );

  if (isPending) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (isError || !project) {
    return <p className="text-sm text-ink-muted">This project no longer exists.</p>;
  }

  return (
    <>
      <PageHeader title={`Edit ${project.code}`} subtitle={project.name} />
      <ProjectForm project={project} />
    </>
  );
}
