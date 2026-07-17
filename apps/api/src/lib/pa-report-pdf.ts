// Official-style PA form PDF (SEIP) — structure aligned with PA1/PA2/PA3 × ส/บส.
// Not a pixel-perfect ก.ค.ศ. print plate (Protected Artifact); generated from
// ReportPayloadV1 + section_refs so layout can be refined without schema changes.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import {
  coerceReportPayloadV1,
  isReportPayloadReady,
  type ReportPayloadV1,
} from '@seip/backend-shared';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Walk up from dist/ or src/ to monorepo root (contains assets/fonts). */
function findFontPath(): string | null {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, 'assets/fonts/NotoSansThai-Regular.ttf');
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, '..');
  }
  return null;
}

export interface PaReportPdfInput {
  id: string;
  templateCode: string;
  status: string;
  generatedAt: Date | string;
  /** Prefer typed ReportPayloadV1; unknown JSON is coerced. */
  payload: ReportPayloadV1 | Record<string, unknown> | unknown;
  sectionRefs: { sectionKey: string; evidenceId: string | null; mappingId: string | null; sortOrder: number }[];
}

const TEMPLATE_TITLES: Record<string, string> = {
  PA1_s: 'แบบข้อตกลงในการพัฒนางาน (PA1) — ครู (ส)',
  PA1_bs: 'แบบข้อตกลงในการพัฒนางาน (PA1) — ผู้บริหาร (บส)',
  PA2_s: 'แบบประเมินผลการพัฒนางานตามข้อตกลง (PA2) — ครู (ส)',
  PA2_bs: 'แบบประเมินผลการพัฒนางานตามข้อตกลง (PA2) — ผู้บริหาร (บส)',
  PA3_s: 'แบบสรุปผลการประเมิน (PA3) — ครู (ส)',
  PA3_bs: 'แบบสรุปผลการประเมิน (PA3) — ผู้บริหาร (บส)',
};

function str(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/**
 * Build a multi-page A4 PDF buffer for a report instance.
 * Throws if payload generation is still pending (caller should map to RPT-002).
 */
export async function buildPaReportPdf(input: PaReportPdfInput): Promise<Buffer> {
  const payload = coerceReportPayloadV1(input.payload);
  if (!isReportPayloadReady(payload) || input.status === 'draft') {
    throw new Error('REPORT_NOT_READY');
  }

  const fontPath = findFontPath();
  const chunks: Buffer[] = [];

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 48, bottom: 48, left: 48, right: 48 },
    info: {
      Title: `${input.templateCode} — ${TEMPLATE_TITLES[input.templateCode] ?? input.templateCode}`,
      Author: 'SEIP',
      Subject: 'รายงานการประเมิน PA (สร้างจากข้อมูลระบบ)',
    },
  });

  doc.on('data', (c: Buffer) => chunks.push(c));

  const done = new Promise<Buffer>((resolvePromise, reject) => {
    doc.on('end', () => resolvePromise(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  if (fontPath) {
    doc.registerFont('Thai', fontPath);
    doc.font('Thai');
  } else {
    doc.font('Helvetica');
  }

  const title = TEMPLATE_TITLES[input.templateCode] ?? input.templateCode;
  doc.fontSize(14).text(title, { align: 'center' });
  doc.moveDown(0.4);
  doc.fontSize(9).fillColor('#444').text(
    'เอกสารสร้างโดย SEIP จากข้อมูลโครงสร้าง (Report.payload) — รูปแบบอ้างอิงแบบ PA ก.ค.ศ. '
    + 'ยังไม่ใช่ต้นฉบับลายเซ็นกระดาษอย่างเป็นทางการ ใช้สำหรับร่าง/ตรวจสอบก่อนพิมพ์',
    { align: 'center' },
  );
  doc.fillColor('#000');
  doc.moveDown(1);

  const { subject, cycle, round } = payload;

  section(doc, '1. ข้อมูลผู้รับการประเมินและรอบ');
  line(doc, 'ชื่อ-สกุล', str(subject.full_name));
  line(doc, 'บทบาท', str(subject.position_role));
  line(doc, 'ระดับวิทยฐานะ (code)', str(subject.rank_level_code));
  line(doc, 'personnel_id', str(subject.personnel_id));
  line(doc, 'รอบการประเมิน', str(cycle.title));
  line(doc, 'ปีงบประมาณ', str(cycle.fiscal_year));
  line(doc, 'ประเภท', str(cycle.evaluation_kind));
  line(doc, 'กรอบตัวชี้วัด', `${str(cycle.framework_code)} — ${str(cycle.framework_legal_ref)}`);
  if (round) {
    line(doc, 'รอบย่อย', `ที่ ${str(round.round_number)}: ${str(round.purpose)} (${str(round.status)})`);
  }
  line(doc, 'รหัสรายงาน', input.id);
  line(doc, 'สถานะในระบบ', input.status);
  line(doc, 'สร้างเมื่อ', typeof input.generatedAt === 'string' ? input.generatedAt : input.generatedAt.toISOString());

  doc.moveDown(0.8);
  section(doc, '2. ผลการประเมิน (ต่อกรรมการ)');
  if (payload.assignments.length === 0) {
    doc.fontSize(10).text('ยังไม่มีผลคะแนนจากกรรมการในรอบนี้');
  } else {
    for (const a of payload.assignments) {
      doc.fontSize(10).text(
        `มอบหมาย ${str(a.assignment_id).slice(0, 8)}… · รอบที่ ${str(a.round_number)} · สถานะ ${str(a.status)} · กรรมการ ${str(a.committee_size)} คน`,
      );
      for (const r of a.evaluator_results) {
        const pass = r.passed_individual_threshold ? 'ผ่าน ≥70%' : 'ไม่ถึงเกณฑ์';
        doc.fontSize(9).text(
          `  • ${str(r.evaluator_user_id).slice(0, 8)}… รวม ${str(r.total_percent)}% (ส่วน1 ${str(r.part1_percent)}% · ส่วน2 ${str(r.part2_percent)}%) — ${pass}`,
        );
      }
      doc.moveDown(0.3);
    }
  }

  doc.moveDown(0.5);
  section(doc, '3. หลักฐานที่ผูกตัวชี้วัด (ยืนยันแล้ว)');
  if (payload.confirmed_mappings.length === 0) {
    doc.fontSize(10).text('ไม่มี mapping ที่ยืนยันแล้ว');
  } else {
    for (const m of payload.confirmed_mappings) {
      doc.fontSize(9).text(
        `• [${str(m.indicator_code)}] ${str(m.indicator_name_th)} — หลักฐาน: ${str(m.evidence_title)}`,
      );
    }
  }

  if (input.sectionRefs.length > 0) {
    doc.moveDown(0.5);
    section(doc, '4. Section refs (อ้างอิงในรายงาน)');
    for (const s of [...input.sectionRefs].sort((a, b) => a.sortOrder - b.sortOrder)) {
      doc.fontSize(9).text(`• ${s.sectionKey}${s.evidenceId ? ` · evidence ${s.evidenceId.slice(0, 8)}…` : ''}`);
    }
  }

  doc.moveDown(1.2);
  section(doc, '5. ช่องลงนาม (สำหรับพิมพ์)');
  doc.fontSize(10);
  doc.text('ผู้รับการประเมิน ............................................. วันที่ ........../........../..........');
  doc.moveDown(0.6);
  doc.text('ประธานกรรมการ ............................................. วันที่ ........../........../..........');
  doc.moveDown(0.6);
  doc.text('กรรมการ (1) ............................................. วันที่ ........../........../..........');
  doc.moveDown(0.6);
  doc.text('กรรมการ (2) ............................................. วันที่ ........../........../..........');

  doc.moveDown(1);
  doc.fontSize(8).fillColor('#666').text(
    `SEIP template=${input.templateCode} · payload schema_version=${str(payload.schema_version)} · generated_at=${str(payload.generated_at)}`,
    { align: 'center' },
  );

  doc.end();
  return done;
}

function section(doc: PDFKit.PDFDocument, title: string): void {
  doc.fontSize(11).fillColor('#000').text(title, { underline: true });
  doc.moveDown(0.3);
}

function line(doc: PDFKit.PDFDocument, label: string, value: string): void {
  doc.fontSize(10).text(`${label}: ${value}`);
}

/** Sync smoke for tests — write PDF to path (optional). */
export async function writePaReportPdfFile(input: PaReportPdfInput, outPath: string): Promise<void> {
  const buf = await buildPaReportPdf(input);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outPath, buf);
}

export function isPdfBuffer(buf: Buffer): boolean {
  return buf.length > 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-';
}
