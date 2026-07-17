// report.generate — fill Report.payload + section_refs from confirmed mappings
// and assignment results. Idempotent: retries wipe section refs and rewrite payload.
import { generateReportPayload } from '@seip/database';

export interface ReportGeneratePayload {
  report_id: string;
  school_id: string;
  actor_user_id?: string | null;
  request_id?: string | null;
}

export async function processReportGenerate(payload: ReportGeneratePayload): Promise<void> {
  if (!payload.report_id) throw new Error('report.generate missing report_id');
  const result = await generateReportPayload(payload.report_id);
  if (!result) throw new Error(`report ${payload.report_id} not found`);
}
