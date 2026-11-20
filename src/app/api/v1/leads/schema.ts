import { z } from 'zod';

/**
 * What may be sent about a lead.
 *
 * Only the name, the number and the source are asked for: an inquiry arrives
 * before anybody knows what the caller wants, and a form that refuses to save
 * without a project and a budget is a form the sales desk works around.
 *
 * Not here: `code` (the series gives it), `status` and `lost_reason` (they
 * move through the status and stage routes, which log the move), and
 * `interested_unit_id` (units are Phase 2 — AGENTS.md).
 */

export const LEAD_STATUS = [
  'new',
  'contacted',
  'site_visit_scheduled',
  'site_visit_done',
  'negotiation',
  'booked',
  'lost',
] as const;

export const LEAD_SOURCE = [
  'website_form',
  'whatsapp',
  'facebook_ad',
  'walk_in',
  'referral',
  'phone_call',
  'other',
] as const;

export const LEAD_ACTIVITY_TYPE = [
  'call',
  'whatsapp',
  'email',
  'site_visit',
  'meeting',
  'status_change',
  'other',
] as const;

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-20.');
const text = (max: number) => z.string().trim().max(max).nullable();

export const LeadFields = z.object({
  name: z.string().trim().min(2, 'Who is this?').max(200),
  phone: z.string().trim().min(6, 'Eleven digits, starting 01.').max(20),
  email: z.string().trim().email('That email does not look right.').max(200).nullable(),
  source: z.enum(LEAD_SOURCE),
  inquiry_message: text(4000),
  interested_project_id: z.string().uuid().nullable(),
  budget_range: text(80),
  assigned_to: z.string().uuid().nullable(),

  /** website attribution, sent by the public enquiry form */
  page_url: text(400),
  utm_source: text(120),
  utm_medium: text(120),
  utm_campaign: text(120),
});

export const LeadCreate = LeadFields.partial().extend({
  name: LeadFields.shape.name,
  phone: LeadFields.shape.phone,
  source: LeadFields.shape.source,
});

export const LeadUpdate = LeadFields.partial();

/** Moving the lead: lost, or revived to an earlier stage. */
export const LeadStatusChange = z.object({
  /*
   * `booked` is accepted by the parser and refused by the service, with the
   * reason — a 422 saying "invalid enum value" would tell nobody that a lead
   * becomes booked by buying shares.
   */
  status: z.enum(LEAD_STATUS),
  notes: z.string().trim().max(2000).default(''),
  next_follow_up_date: dateOnly.nullable().optional(),
});

/** Completing the stage the lead is in (`domain/lead-stages.ts`). */
export const LeadStageCompletion = z.object({
  to: z.enum(LEAD_STATUS),
  activity_type: z.enum(LEAD_ACTIVITY_TYPE),
  event_date: dateOnly,
  title: z.string().trim().min(1).max(200),
  /** label → value, as the log will show it */
  details: z.record(z.string().max(200), z.string().max(1000)).optional(),
  notes: z.string().trim().max(2000).optional(),
  next_follow_up_date: dateOnly.nullable().optional(),
  updates: z
    .object({
      budget_range: text(80).optional(),
      interested_project_id: z.string().uuid().nullable().optional(),
    })
    .optional(),
});

export const LeadAssignment = z.object({
  assigned_to: z.string().uuid().nullable(),
});

export const LeadActivityCreate = z.object({
  activity_type: z.enum(LEAD_ACTIVITY_TYPE),
  notes: z.string().trim().min(1, 'What was said?').max(4000),
  /** when it happened, as an ISO timestamp or a plain day */
  activity_date: z.string().trim().max(40).optional(),
  next_follow_up_date: dateOnly.nullable().optional(),
});

/** Making the investor from the lead. */
export const LeadConversion = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
});
