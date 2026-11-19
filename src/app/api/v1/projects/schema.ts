import { z } from 'zod';

/**
 * What may be sent about a project.
 *
 * Shared by the create and the update route so the two cannot drift: create
 * requires a name, update makes every field optional, and neither accepts a
 * column a person has no business setting (`code`, `sales_status`,
 * `created_by`, the timestamps).
 */

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-04-01.')
  .nullable();

export const ProjectFields = z.object({
  name: z.string().trim().min(2, 'Project name is required.').max(200),
  project_type: z.enum(['land_share', 'plot_development', 'apartment', 'commercial', 'mixed']),
  status: z.enum([
    'planning',
    'design',
    'approval',
    'under_construction',
    'nearly_complete',
    'handover_ongoing',
    'closed',
  ]),
  total_land_area: z.number().positive('Enter the area as a number.').max(99_999_999).nullable(),
  total_land_area_unit: z.enum(['katha', 'bigha', 'decimal']).nullable(),
  description: z.string().trim().max(8000).nullable(),
  location_summary: z.string().trim().max(300).nullable(),
  /*
   * The valuation block. It is on the project, not on a round, because one
   * share has to mean the same thing in every round — and the service refuses
   * it once a round has been on the market.
   */
  valuation: z.number().positive('What 100% of this project is worth.').nullable(),
  total_shares: z
    .number()
    .int()
    .min(1, 'At least one share.')
    .max(10_000_000)
    .nullable(),
  valuation_date: dateOnly,
  expected_start_date: dateOnly,
  expected_completion_date: dateOnly,
  project_manager_id: z.string().uuid('Pick a project manager from the list.').nullable(),
  architect: z.string().trim().max(200).nullable(),
  surroundings: z.string().trim().max(4000).nullable(),
  amenities: z.array(z.string().trim().min(1).max(120)).max(100),
  cover_image_url: z.string().trim().max(400).nullable(),
  cover_image_document_id: z.string().uuid().nullable(),
  construction_after_sale: z.enum(['undecided', 'planned', 'none']),
  default_late_fee_pct: z.number().min(0).max(100).nullable(),
  default_late_fee_grace_days: z.number().int().min(0).max(365).nullable(),
  is_public: z.boolean(),
  is_featured: z.boolean(),
});

/** Creating: the name is the only thing a person must decide. */
export const ProjectCreate = ProjectFields.partial().extend({
  name: ProjectFields.shape.name,
});

/** Updating: whatever was sent, and nothing else. */
export const ProjectUpdate = ProjectFields.partial();

export const SalesStatusBody = z.object({
  sales_status: z.enum(['not_open', 'open', 'paused', 'sold_out']),
});
