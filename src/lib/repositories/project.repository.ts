'use client';

import { db } from '../db/database';
import type {
  Project,
  ProjectSalesStatus,
  ProjectStatus,
  ProjectType,
} from '../db/types';
import { nextCode } from '../utils/id';
import { BaseRepository, type NewRecord } from './base.repository';
import { documentRepository } from './document.repository';
import { userProjectAssignmentRepository } from './user.repository';

export interface ProjectFilters {
  search?: string;
  status?: ProjectStatus | 'all';
  project_type?: ProjectType | 'all';
  is_public?: boolean;
}

/**
 * Projects, Phase 1 (share-sale build).
 *
 * The land, tower, unit and JV-allocation sides of this repository belong to
 * modules this build does not carry — they stay in the prototype's history and
 * come back in Phase 2. What a project is here: a master record, the money it
 * earns (revenue / profit sharing), its share offerings, and its documents.
 */
class ProjectRepository extends BaseRepository<Project> {
  constructor() {
    super(() => db.projects);
  }

  /** Next PRJ-YYYY-NNN code. */
  async generateCode(): Promise<string> {
    const codes = (await db.projects.toArray()).map((p) => p.code);
    return nextCode('PRJ', codes);
  }

  async create(input: NewRecord<Project>, createdBy: string | null = null): Promise<Project> {
    const code = input.code?.trim() ? input.code : await this.generateCode();
    // a new project is not selling until somebody opens its sales
    return super.create({ sales_status: 'not_open', ...input, code }, createdBy);
  }

  async list(filters: ProjectFilters = {}): Promise<Project[]> {
    const { search, status, project_type, is_public } = filters;
    let rows = await db.projects.toArray();

    if (status && status !== 'all') rows = rows.filter((p) => p.status === status);
    if (project_type && project_type !== 'all') {
      rows = rows.filter((p) => p.project_type === project_type);
    }
    if (is_public !== undefined) rows = rows.filter((p) => p.is_public === is_public);
    if (search?.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((p) =>
        [p.code, p.name, p.location_summary, p.architect]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q)),
      );
    }
    return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  /*
   * `null`, not `undefined`, when the record is gone. `useLiveQuery` reports
   * its own pending state as `undefined`, so a repository returning
   * `undefined` for "no such row" leaves the detail page unable to tell a
   * deleted record from a query still in flight — it sat on "Loading…"
   * forever instead of saying the record no longer exists.
   */
  async get(id: string): Promise<Project | null> {
    return (await this.getById(id)) ?? null;
  }

  /**
   * Opening, pausing and closing sales.
   *
   * Phase 1 has no construction or inventory to check a move against, and the
   * pipeline status flow is switched off at the client's request, so the moves
   * are the plain ones: a project not yet open can open, an open one can be
   * paused or closed, a paused one can reopen.
   */
  async setSalesStatus(projectId: string, sales_status: ProjectSalesStatus): Promise<void> {
    const project = await this.getById(projectId);
    if (!project) return;
    await this.update(projectId, { sales_status });
  }

  async countByStatus(): Promise<Record<string, number>> {
    const rows = await db.projects.toArray();
    return rows.reduce<Record<string, number>>((acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
      return acc;
    }, {});
  }

  /**
   * A project with money against it is closed, not deleted.
   *
   * Phase 1's money is share sale and the revenue it earns, so those are what
   * is counted here (the prototype also counted purchase orders, expenses and
   * site material).
   */
  async deleteBlockReason(id: string): Promise<string | null> {
    const [offerings, sales, entries, periods] = await Promise.all([
      db.share_offerings.where('project_id').equals(id).count(),
      db.share_sales.where('project_id').equals(id).count(),
      db.revenue_entries.where('project_id').equals(id).count(),
      db.revenue_periods.where('project_id').equals(id).count(),
    ]);
    const parts: string[] = [];
    if (offerings) parts.push(`${offerings} share offering${offerings === 1 ? '' : 's'}`);
    if (sales) parts.push(`${sales} share purchase${sales === 1 ? '' : 's'}`);
    if (entries) parts.push(`${entries} income/cost entr${entries === 1 ? 'y' : 'ies'}`);
    if (periods) parts.push(`${periods} profit period${periods === 1 ? '' : 's'}`);
    if (parts.length) {
      return `This project has ${parts.join(', ')}. Deleting it would orphan them; close the project instead.`;
    }
    return null;
  }

  async removeCascade(id: string): Promise<void> {
    const blocked = await this.deleteBlockReason(id);
    if (blocked) throw new Error(blocked);
    // staff scoping points at this project; leaving the rows would give a user
    // an assignment to something that no longer exists
    await userProjectAssignmentRepository.removeForProject(id);
    await documentRepository.removeForEntity('project', id);
    await this.remove(id);
  }
}

export const projectRepository = new ProjectRepository();
