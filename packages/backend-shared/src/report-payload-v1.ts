/**
 * Report.payload schema_version=1 — single typed shape for worker → DB JSON →
 * API → PDF → (OpenAPI-mirrored) UI. Replaces ad-hoc Record<string, unknown> casts.
 *
 * Keep in sync with docs/contracts/openapi.yaml components.schemas.ReportPayload.
 */

export const REPORT_PAYLOAD_SCHEMA_VERSION = 1 as const;

export const REPORT_TEMPLATE_CODES = [
  'PA1_s', 'PA1_bs', 'PA2_s', 'PA2_bs', 'PA3_s', 'PA3_bs',
] as const;
export type ReportTemplateCode = (typeof REPORT_TEMPLATE_CODES)[number];

export type ReportGenerationStatus = 'pending' | 'ready';

export interface ReportPayloadSubjectV1 {
  personnel_id: string;
  full_name: string;
  position_role: string;
  rank_level_code: string;
}

export interface ReportPayloadCycleV1 {
  id: string;
  title: string;
  fiscal_year: number;
  evaluation_kind: string;
  framework_code: string;
  framework_legal_ref: string;
}

export interface ReportPayloadRoundV1 {
  id: string;
  round_number: number;
  purpose: string;
  status: string;
}

export interface ReportPayloadConfirmedMappingV1 {
  mapping_id: string;
  evidence_id: string;
  evidence_title: string;
  indicator_id: string;
  indicator_code: string;
  indicator_name_th: string;
  confirmed_at: string | null;
}

export interface ReportPayloadEvaluatorResultV1 {
  evaluator_user_id: string;
  part1_percent: number;
  part2_percent: number;
  total_percent: number;
  passed_individual_threshold: boolean;
  computed_at: string;
}

export interface ReportPayloadAssignmentV1 {
  assignment_id: string;
  round_id: string;
  round_number: number;
  status: string;
  committee_size: number;
  evaluator_results: ReportPayloadEvaluatorResultV1[];
}

/** Draft row immediately after createReport — worker not finished. */
export interface ReportPayloadV1Pending {
  schema_version: typeof REPORT_PAYLOAD_SCHEMA_VERSION;
  generation_status: 'pending';
  template_code: string;
}

/** Worker-filled payload (generation_status=ready). */
export interface ReportPayloadV1Ready {
  schema_version: typeof REPORT_PAYLOAD_SCHEMA_VERSION;
  generation_status: 'ready';
  template_code: string;
  subject: ReportPayloadSubjectV1;
  cycle: ReportPayloadCycleV1;
  round: ReportPayloadRoundV1 | null;
  confirmed_mappings: ReportPayloadConfirmedMappingV1[];
  assignments: ReportPayloadAssignmentV1[];
  generated_at: string;
}

export type ReportPayloadV1 = ReportPayloadV1Pending | ReportPayloadV1Ready;

export function isReportTemplateCode(v: string): v is ReportTemplateCode {
  return (REPORT_TEMPLATE_CODES as readonly string[]).includes(v);
}

export function isReportPayloadReady(p: ReportPayloadV1): p is ReportPayloadV1Ready {
  return p.generation_status === 'ready';
}

export function pendingReportPayloadV1(templateCode: string): ReportPayloadV1Pending {
  return {
    schema_version: REPORT_PAYLOAD_SCHEMA_VERSION,
    generation_status: 'pending',
    template_code: templateCode,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown, field: string): string {
  if (typeof v !== 'string') throw new Error(`ReportPayloadV1: ${field} must be string`);
  return v;
}

function asNumber(v: unknown, field: string): number {
  if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`ReportPayloadV1: ${field} must be number`);
  return v;
}

function asBoolean(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw new Error(`ReportPayloadV1: ${field} must be boolean`);
  return v;
}

/**
 * Parse unknown JSON (Prisma Json / HTTP body) into ReportPayloadV1.
 * Throws Error with a stable prefix when the shape is not schema_version=1.
 */
export function parseReportPayloadV1(raw: unknown): ReportPayloadV1 {
  if (!isRecord(raw)) throw new Error('ReportPayloadV1: payload must be an object');
  const schema_version = asNumber(raw.schema_version, 'schema_version');
  if (schema_version !== REPORT_PAYLOAD_SCHEMA_VERSION) {
    throw new Error(`ReportPayloadV1: unsupported schema_version ${schema_version}`);
  }
  const generation_status = asString(raw.generation_status, 'generation_status');
  const template_code = asString(raw.template_code, 'template_code');

  if (generation_status === 'pending') {
    return { schema_version: REPORT_PAYLOAD_SCHEMA_VERSION, generation_status: 'pending', template_code };
  }
  if (generation_status !== 'ready') {
    throw new Error(`ReportPayloadV1: unknown generation_status ${generation_status}`);
  }

  if (!isRecord(raw.subject)) throw new Error('ReportPayloadV1: subject required when ready');
  if (!isRecord(raw.cycle)) throw new Error('ReportPayloadV1: cycle required when ready');
  if (raw.round !== null && raw.round !== undefined && !isRecord(raw.round)) {
    throw new Error('ReportPayloadV1: round must be object or null');
  }
  if (!Array.isArray(raw.confirmed_mappings)) {
    throw new Error('ReportPayloadV1: confirmed_mappings must be array');
  }
  if (!Array.isArray(raw.assignments)) {
    throw new Error('ReportPayloadV1: assignments must be array');
  }

  const subject: ReportPayloadSubjectV1 = {
    personnel_id: asString(raw.subject.personnel_id, 'subject.personnel_id'),
    full_name: asString(raw.subject.full_name, 'subject.full_name'),
    position_role: asString(raw.subject.position_role, 'subject.position_role'),
    rank_level_code: asString(raw.subject.rank_level_code, 'subject.rank_level_code'),
  };

  const cycle: ReportPayloadCycleV1 = {
    id: asString(raw.cycle.id, 'cycle.id'),
    title: asString(raw.cycle.title, 'cycle.title'),
    fiscal_year: asNumber(raw.cycle.fiscal_year, 'cycle.fiscal_year'),
    evaluation_kind: asString(raw.cycle.evaluation_kind, 'cycle.evaluation_kind'),
    framework_code: asString(raw.cycle.framework_code, 'cycle.framework_code'),
    framework_legal_ref: asString(raw.cycle.framework_legal_ref, 'cycle.framework_legal_ref'),
  };

  let round: ReportPayloadRoundV1 | null = null;
  if (isRecord(raw.round)) {
    round = {
      id: asString(raw.round.id, 'round.id'),
      round_number: asNumber(raw.round.round_number, 'round.round_number'),
      purpose: asString(raw.round.purpose, 'round.purpose'),
      status: asString(raw.round.status, 'round.status'),
    };
  }

  const confirmed_mappings: ReportPayloadConfirmedMappingV1[] = raw.confirmed_mappings.map((m, i) => {
    if (!isRecord(m)) throw new Error(`ReportPayloadV1: confirmed_mappings[${i}] must be object`);
    const confirmed_at = m.confirmed_at;
    if (confirmed_at !== null && typeof confirmed_at !== 'string') {
      throw new Error(`ReportPayloadV1: confirmed_mappings[${i}].confirmed_at must be string|null`);
    }
    return {
      mapping_id: asString(m.mapping_id, `confirmed_mappings[${i}].mapping_id`),
      evidence_id: asString(m.evidence_id, `confirmed_mappings[${i}].evidence_id`),
      evidence_title: asString(m.evidence_title, `confirmed_mappings[${i}].evidence_title`),
      indicator_id: asString(m.indicator_id, `confirmed_mappings[${i}].indicator_id`),
      indicator_code: asString(m.indicator_code, `confirmed_mappings[${i}].indicator_code`),
      indicator_name_th: asString(m.indicator_name_th, `confirmed_mappings[${i}].indicator_name_th`),
      confirmed_at: confirmed_at as string | null,
    };
  });

  const assignments: ReportPayloadAssignmentV1[] = raw.assignments.map((a, i) => {
    if (!isRecord(a)) throw new Error(`ReportPayloadV1: assignments[${i}] must be object`);
    if (!Array.isArray(a.evaluator_results)) {
      throw new Error(`ReportPayloadV1: assignments[${i}].evaluator_results must be array`);
    }
    return {
      assignment_id: asString(a.assignment_id, `assignments[${i}].assignment_id`),
      round_id: asString(a.round_id, `assignments[${i}].round_id`),
      round_number: asNumber(a.round_number, `assignments[${i}].round_number`),
      status: asString(a.status, `assignments[${i}].status`),
      committee_size: asNumber(a.committee_size, `assignments[${i}].committee_size`),
      evaluator_results: a.evaluator_results.map((r, j) => {
        if (!isRecord(r)) throw new Error(`ReportPayloadV1: assignments[${i}].evaluator_results[${j}] must be object`);
        return {
          evaluator_user_id: asString(r.evaluator_user_id, `assignments[${i}].evaluator_results[${j}].evaluator_user_id`),
          part1_percent: asNumber(r.part1_percent, `assignments[${i}].evaluator_results[${j}].part1_percent`),
          part2_percent: asNumber(r.part2_percent, `assignments[${i}].evaluator_results[${j}].part2_percent`),
          total_percent: asNumber(r.total_percent, `assignments[${i}].evaluator_results[${j}].total_percent`),
          passed_individual_threshold: asBoolean(
            r.passed_individual_threshold,
            `assignments[${i}].evaluator_results[${j}].passed_individual_threshold`,
          ),
          computed_at: asString(r.computed_at, `assignments[${i}].evaluator_results[${j}].computed_at`),
        };
      }),
    };
  });

  return {
    schema_version: REPORT_PAYLOAD_SCHEMA_VERSION,
    generation_status: 'ready',
    template_code,
    subject,
    cycle,
    round,
    confirmed_mappings,
    assignments,
    generated_at: asString(raw.generated_at, 'generated_at'),
  };
}

/**
 * Soft parse for API/PDF: pending-or-ready without throwing on partial ready fields.
 * Falls back to treating unknown ready-ish objects as pending when shape is incomplete.
 * Prefer parseReportPayloadV1 when constructing or when validation must fail hard.
 */
export function coerceReportPayloadV1(raw: unknown): ReportPayloadV1 {
  try {
    return parseReportPayloadV1(raw);
  } catch {
    if (isRecord(raw) && raw.generation_status === 'pending' && typeof raw.template_code === 'string') {
      return {
        schema_version: REPORT_PAYLOAD_SCHEMA_VERSION,
        generation_status: 'pending',
        template_code: raw.template_code,
      };
    }
    // Legacy / corrupt row: surface as pending so PDF path returns RPT-002 not 500.
    return {
      schema_version: REPORT_PAYLOAD_SCHEMA_VERSION,
      generation_status: 'pending',
      template_code: isRecord(raw) && typeof raw.template_code === 'string' ? raw.template_code : 'unknown',
    };
  }
}
