// SEIP-DB-003 — IndicatorLevelDescription seed builders.
// See ./README.md for provenance. Rubric anchors from evaluation-framework.md
// §Scoring model; indicator/rank labels from the same framework extraction.

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
 * Builds Thai expected-practice text for one (indicator, rank, rubric) cell.
 * Structure is complete for runtime; wording is framework-anchored, not a
 * verbatim multi-page PDF transcription (see README.md).
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
  const kindNote =
    p.indicatorKind === 'challenge'
      ? ' (ประเด็นท้าทาย — ระดับคะแนนตามสัดส่วน 4=100% … 1=25% ของคะแนนเต็มรายการ)'
      : '';

  return (
    `[${p.rankLabelTh}] ตัวชี้วัด ${p.indicatorCode} ${p.indicatorNameTh}${kindNote}. ` +
    `ระดับ ${p.rubricLevel}: ${rubricLabel}. ` +
    `พิจารณาเทียบระดับการปฏิบัติที่คาดหวังของวิทยฐานะ/ตำแหน่งนี้ตาม ${p.legalRef}. ` +
    `(seed โครงสร้าง SEIP-DB-003 — แทนที่ด้วยข้อความเชิงพฤติกรรมจากคู่มือฉบับเต็มได้โดยไม่ต้อง migrate schema)`
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
