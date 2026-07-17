// SEIP-DB-003 (structure) + SEIP-DB-004 (real content) — IndicatorLevelDescription
// seed builders. See ./README.md for provenance. Rubric anchors from
// evaluation-framework.md §Scoring model; indicator/rank labels from the same
// framework extraction; per-indicator×rank expected-practice text (rubricLevel=3
// baseline) from level-description-anchors.mjs (real PA 2/ส / PA 2/บส transcription).

import { REAL_ANCHOR_TEXT } from './level-description-anchors.mjs';

/** @type {Record<number, string>} */
export const RUBRIC_LEVEL_LABELS = {
  1: 'ต่ำกว่าที่คาดหวังมาก',
  2: 'ต่ำกว่าที่คาดหวัง',
  3: 'ตามที่คาดหวัง',
  4: 'สูงกว่าที่คาดหวัง',
};

/**
 * Teacher rank codes used for ว9 (order matches seed RANK_LEVELS).
 * @type {string[]}
 */
export const TEACHER_RANK_CODES = [
  'execute_learn',
  'apply_adapt',
  'solve_problem',
  'originate_improve',
  'invent_transform',
  'create_impact',
];

/**
 * Administrator rank codes used for ว10.
 * @type {string[]}
 */
export const ADMIN_RANK_CODES = [
  'admin_apply_adapt',
  'admin_solve_problem',
  'admin_originate_improve',
  'admin_invent_transform',
  'admin_create_impact',
];

/**
 * Frames the real anchor text (the "ตามที่คาดหวัง" / rubricLevel=3 reference
 * standard, transcribed verbatim from the PA 2/ส|บส form) against each of the
 * 4 generic rubric levels. Only rubricLevel=3 IS the source text; levels 1/2/4
 * have no separate source paragraph (the PDF has one anchor per indicator×rank,
 * not per rubric level) — they honestly reference the same anchor with
 * comparison framing, never inventing new regulatory wording.
 * @type {Record<number, (anchor: string) => string>}
 */
const LEVEL_FRAMING = {
  1: (anchor) => `ปฏิบัติได้ต่ำกว่าระดับการปฏิบัติที่คาดหวังของวิทยฐานะ/ตำแหน่งนี้อย่างมาก เมื่อเทียบกับเกณฑ์ที่คาดหวัง ซึ่งกำหนดไว้ว่า "${anchor}"`,
  2: (anchor) => `ปฏิบัติได้ต่ำกว่าระดับการปฏิบัติที่คาดหวังของวิทยฐานะ/ตำแหน่งนี้ เมื่อเทียบกับเกณฑ์ที่คาดหวัง ซึ่งกำหนดไว้ว่า "${anchor}"`,
  3: (anchor) => `ปฏิบัติได้ตามระดับการปฏิบัติที่คาดหวังของวิทยฐานะ/ตำแหน่งนี้ กล่าวคือ "${anchor}"`,
  4: (anchor) => `ปฏิบัติได้สูงกว่าระดับการปฏิบัติที่คาดหวังของวิทยฐานะ/ตำแหน่งนี้ โดยมีผลการปฏิบัติเกินกว่าเกณฑ์ที่คาดหวัง ซึ่งกำหนดไว้ว่า "${anchor}"`,
};

/**
 * Structural placeholder — used only when no real anchor text exists for a
 * (rankCode, indicatorCode) pair (currently: execute_learn/ครูผู้ช่วย, which
 * has no PA 2/ส form of its own — see level-description-anchors.mjs header).
 * @param {{
 *   indicatorCode: string,
 *   indicatorNameTh: string,
 *   indicatorKind: string,
 *   rankCode: string,
 *   rankLabelTh: string,
 *   rubricLevel: number,
 *   legalRef: string,
 * }} p
 */
function buildPlaceholderTh(p) {
  const rubricLabel = RUBRIC_LEVEL_LABELS[p.rubricLevel];
  const kindNote =
    p.indicatorKind === 'challenge'
      ? ' (ประเด็นท้าทาย — ระดับคะแนนตามสัดส่วน 4=100% … 1=25% ของคะแนนเต็มรายการ)'
      : '';

  return (
    `[${p.rankLabelTh}] ตัวชี้วัด ${p.indicatorCode} ${p.indicatorNameTh}${kindNote}. ` +
    `ระดับ ${p.rubricLevel}: ${rubricLabel}. ` +
    `พิจารณาเทียบระดับการปฏิบัติที่คาดหวังของวิทยฐานะ/ตำแหน่งนี้ตาม ${p.legalRef}. ` +
    `(ตำแหน่งนี้ไม่มีแบบฟอร์ม PA 2/ส ของตนเอง — ครูผู้ช่วยใช้กลไกการประเมิน ` +
    `"เตรียมความพร้อมและพัฒนาอย่างเข้ม" แยกต่างหาก ไม่ใช่รอบ PA นี้ ` +
    `จึงไม่มีข้อความอ้างอิงจาก PDF จริงสำหรับเซลล์นี้)`
  );
}

/**
 * Builds Thai expected-practice text for one (indicator, rank, rubric) cell.
 * Uses the real PA 2/ส|บส anchor text when one exists for this (rankCode,
 * indicatorCode) pair (see level-description-anchors.mjs); falls back to a
 * clearly-labeled structural placeholder otherwise (execute_learn only).
 *
 * @param {{
 *   indicatorCode: string,
 *   indicatorNameTh: string,
 *   indicatorKind: string,
 *   rankCode: string,
 *   rankLabelTh: string,
 *   rubricLevel: number,
 *   legalRef: string,
 * }} p
 */
export function buildExpectedPracticeTh(p) {
  const rubricLabel = RUBRIC_LEVEL_LABELS[p.rubricLevel];
  if (!rubricLabel) {
    throw new Error(`invalid rubricLevel ${p.rubricLevel}`);
  }

  const anchor = REAL_ANCHOR_TEXT[p.rankCode]?.[p.indicatorCode];
  if (!anchor) {
    return buildPlaceholderTh(p);
  }

  const kindNote =
    p.indicatorKind === 'challenge'
      ? ' (ประเด็นท้าทาย — ระดับคะแนนตามสัดส่วน 4=100% … 1=25% ของคะแนนเต็มรายการ)'
      : '';

  return (
    `[${p.rankLabelTh}] ตัวชี้วัด ${p.indicatorCode} ${p.indicatorNameTh}${kindNote}. ` +
    `ระดับ ${p.rubricLevel}: ${rubricLabel}. ` +
    `${LEVEL_FRAMING[p.rubricLevel](anchor)} (อ้างอิง ${p.legalRef})`
  );
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{
 *   frameworkId: string,
 *   legalRef: string,
 *   rankCodes: string[],
 * }} opts
 * @returns {Promise<{ written: number, skippedWorkload: number }>}
 */
export async function seedLevelDescriptionsForFramework(prisma, opts) {
  const ranks = await prisma.rankLevel.findMany({
    where: { code: { in: opts.rankCodes } },
  });
  if (ranks.length !== opts.rankCodes.length) {
    const have = new Set(ranks.map((r) => r.code));
    const missing = opts.rankCodes.filter((c) => !have.has(c));
    throw new Error(`missing rank_level rows: ${missing.join(', ')}`);
  }
  const rankByCode = Object.fromEntries(ranks.map((r) => [r.code, r]));

  const indicators = await prisma.indicator.findMany({
    where: { frameworkVersionId: opts.frameworkId },
    select: { id: true, code: true, nameTh: true, indicatorKind: true, isScored: true },
  });

  let written = 0;
  let skippedWorkload = 0;

  for (const ind of indicators) {
    if (!ind.isScored || ind.indicatorKind === 'workload_gate') {
      skippedWorkload += 1;
      continue;
    }
    for (const rankCode of opts.rankCodes) {
      const rank = rankByCode[rankCode];
      for (const rubricLevel of [1, 2, 3, 4]) {
        const expectedPracticeTh = buildExpectedPracticeTh({
          indicatorCode: ind.code,
          indicatorNameTh: ind.nameTh,
          indicatorKind: ind.indicatorKind,
          rankCode,
          rankLabelTh: rank.labelTh,
          rubricLevel,
          legalRef: opts.legalRef,
        });

        await prisma.indicatorLevelDescription.upsert({
          where: {
            indicatorId_rankLevelCode_rubricLevel: {
              indicatorId: ind.id,
              rankLevelCode: rankCode,
              rubricLevel,
            },
          },
          create: {
            indicatorId: ind.id,
            rankLevelCode: rankCode,
            rubricLevel,
            expectedPracticeTh,
          },
          update: {
            expectedPracticeTh,
          },
        });
        written += 1;
      }
    }
  }

  return { written, skippedWorkload };
}
