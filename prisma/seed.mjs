// SEIP-DB-001 + SEIP-DB-003 seed — versioned taxonomy as DATA (ADR-0003).
// Loads FrameworkVersion rows for ว9/2564 (ครู) and ว10/2564 (ผู้บริหาร),
// domains, indicators, score weights, rank levels, evidence categories, and
// IndicatorLevelDescription cells (DB-003: structure-complete per rank × rubric).
// See prisma/data/README.md for level-description provenance.
//
// Idempotent: re-running upserts by stable `code` keys / compound uniques.
import { PrismaClient } from '@prisma/client';
import {
  ADMIN_RANK_CODES,
  TEACHER_RANK_CODES,
  seedLevelDescriptionsForFramework,
} from './data/level-descriptions.mjs';

const prisma = new PrismaClient();

/** @type {{ code: string, roleFamily: 'teacher'|'administrator', labelTh: string, sortOrder: number }[]} */
const RANK_LEVELS = [
  { code: 'execute_learn', roleFamily: 'teacher', labelTh: 'Execute & Learn (ครูผู้ช่วย)', sortOrder: 1 },
  { code: 'apply_adapt', roleFamily: 'teacher', labelTh: 'Apply & Adapt (ครู)', sortOrder: 2 },
  { code: 'solve_problem', roleFamily: 'teacher', labelTh: 'Solve the Problem (ชำนาญการ)', sortOrder: 3 },
  { code: 'originate_improve', roleFamily: 'teacher', labelTh: 'Originate & Improve (ชำนาญการพิเศษ)', sortOrder: 4 },
  { code: 'invent_transform', roleFamily: 'teacher', labelTh: 'Invent & Transform (เชี่ยวชาญ)', sortOrder: 5 },
  { code: 'create_impact', roleFamily: 'teacher', labelTh: 'Create an Impact (เชี่ยวชาญพิเศษ)', sortOrder: 6 },
  // Administrator track reuses the same practice-tier codes with admin labels where distinct.
  { code: 'admin_apply_adapt', roleFamily: 'administrator', labelTh: 'Apply & Adapt (รอง/ผอ. ไม่มีวิทยฐานะ)', sortOrder: 2 },
  { code: 'admin_solve_problem', roleFamily: 'administrator', labelTh: 'Solve the Problem (ชำนาญการ)', sortOrder: 3 },
  { code: 'admin_originate_improve', roleFamily: 'administrator', labelTh: 'Originate & Improve (ชำนาญการพิเศษ)', sortOrder: 4 },
  { code: 'admin_invent_transform', roleFamily: 'administrator', labelTh: 'Invent & Transform (เชี่ยวชาญ)', sortOrder: 5 },
  { code: 'admin_create_impact', roleFamily: 'administrator', labelTh: 'Create an Impact (เชี่ยวชาญพิเศษ)', sortOrder: 6 },
];

/** Evidence classes named by the framework (evaluation-framework.md §DPA + PA). */
const EVIDENCE_CATEGORIES = [
  {
    code: 'lesson_plan',
    labelTh: 'แผนการจัดการเรียนรู้',
    allowedMimeTypes: ['application/pdf'],
    maxByteSize: 50n * 1024n * 1024n,
    maxDurationSeconds: null,
    requiredForDpa: true,
  },
  {
    code: 'teaching_video',
    labelTh: 'วิดีโอการสอน',
    allowedMimeTypes: ['video/mp4'],
    maxByteSize: 2n * 1024n * 1024n * 1024n,
    maxDurationSeconds: null,
    requiredForDpa: true,
  },
  {
    code: 'inspiration_video',
    labelTh: 'วิดีโอสภาพปัญหา/ที่มา/แรงบันดาลใจ',
    allowedMimeTypes: ['video/mp4'],
    maxByteSize: 512n * 1024n * 1024n,
    maxDurationSeconds: 600, // ว9 ≤10 minutes
    requiredForDpa: true,
  },
  {
    code: 'learner_outcomes',
    labelTh: 'ผลลัพธ์การเรียนรู้ของผู้เรียน',
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'video/mp4'],
    maxByteSize: 1n * 1024n * 1024n * 1024n,
    maxDurationSeconds: null,
    requiredForDpa: true,
  },
  {
    code: 'academic_work',
    labelTh: 'ผลงานทางวิชาการ',
    allowedMimeTypes: ['application/pdf'],
    maxByteSize: 100n * 1024n * 1024n,
    maxDurationSeconds: null,
    requiredForDpa: false, // only เชี่ยวชาญ+
  },
  {
    code: 'other_document',
    labelTh: 'เอกสารอื่น (ทั่วไป)',
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    maxByteSize: 50n * 1024n * 1024n,
    maxDurationSeconds: null,
    requiredForDpa: false,
  },
];

const SCORE_WEIGHTS = [
  { weightKey: 'part1_total', weightValue: 60, notes: 'ส่วนที่ 1 มาตรฐานตำแหน่ง' },
  { weightKey: 'part2_total', weightValue: 40, notes: 'ส่วนที่ 2 ประเด็นท้าทาย' },
  { weightKey: 'challenge_method', weightValue: 20, notes: 'วิธีดำเนินการ (ของ part2)' },
  { weightKey: 'challenge_qty', weightValue: 10, notes: 'ผลลัพธ์เชิงปริมาณ' },
  { weightKey: 'challenge_quality', weightValue: 10, notes: 'ผลลัพธ์เชิงคุณภาพ' },
  { weightKey: 'pass_threshold_percent', weightValue: 70, notes: 'เกณฑ์ผ่านรายบุคคล ≥70%' },
];

// ── ว9 teacher taxonomy (evaluation-framework.md) ──
const V9_DOMAINS = [
  {
    code: 'T-D1',
    nameTh: 'การจัดการเรียนรู้',
    sortOrder: 1,
    part: 'standards',
    indicators: [
      ['T-1.1', 'สร้างและหรือพัฒนาหลักสูตร', 1],
      ['T-1.2', 'ออกแบบการจัดการเรียนรู้', 2],
      ['T-1.3', 'จัดกิจกรรมการเรียนรู้', 3],
      ['T-1.4', 'สร้างและหรือพัฒนาสื่อ นวัตกรรม เทคโนโลยี และแหล่งเรียนรู้', 4],
      ['T-1.5', 'วัดและประเมินผลการเรียนรู้', 5],
      ['T-1.6', 'ศึกษา วิเคราะห์ และสังเคราะห์ เพื่อแก้ปัญหาหรือพัฒนาการเรียนรู้', 6],
      ['T-1.7', 'จัดบรรยากาศที่ส่งเสริมและพัฒนาผู้เรียน', 7],
      ['T-1.8', 'อบรมและพัฒนาคุณลักษณะที่ดีของผู้เรียน', 8],
    ],
  },
  {
    code: 'T-D2',
    nameTh: 'การส่งเสริมและสนับสนุนการจัดการเรียนรู้',
    sortOrder: 2,
    part: 'standards',
    indicators: [
      ['T-2.1', 'จัดทำข้อมูลสารสนเทศของผู้เรียนและรายวิชา', 1],
      ['T-2.2', 'ดำเนินการตามระบบดูแลช่วยเหลือผู้เรียน', 2],
      ['T-2.3', 'ปฏิบัติงานวิชาการ และงานอื่น ๆ ของสถานศึกษา', 3],
      ['T-2.4', 'ประสานความร่วมมือกับผู้ปกครอง ภาคีเครือข่าย และหรือสถานประกอบการ', 4],
    ],
  },
  {
    code: 'T-D3',
    nameTh: 'การพัฒนาตนเองและวิชาชีพ',
    sortOrder: 3,
    part: 'standards',
    indicators: [
      ['T-3.1', 'พัฒนาตนเองอย่างเป็นระบบและต่อเนื่อง', 1],
      ['T-3.2', 'มีส่วนร่วมในการแลกเปลี่ยนเรียนรู้ทางวิชาชีพ', 2],
      ['T-3.3', 'นำความรู้ความสามารถทักษะที่ได้จากการพัฒนาตนเองและวิชาชีพมาใช้', 3],
    ],
  },
  {
    code: 'T-C',
    nameTh: 'ประเด็นท้าทายในการพัฒนาผลลัพธ์การเรียนรู้ของผู้เรียน',
    sortOrder: 4,
    part: 'challenge',
    indicators: [
      ['T-C.1', 'วิธีดำเนินการ', 1, 20],
      ['T-C.2.1', 'ผลลัพธ์เชิงปริมาณ', 2, 10],
      ['T-C.2.2', 'ผลลัพธ์เชิงคุณภาพ', 3, 10],
    ],
  },
  {
    code: 'T-W',
    nameTh: 'ภาระงาน (เกณฑ์ผ่าน/ไม่ผ่าน)',
    sortOrder: 0,
    part: 'standards',
    indicators: [
      ['T-W.1', 'ภาระงานตามมาตรฐานตำแหน่ง', 0, null, 'workload_gate'],
    ],
  },
];

// ── ว10 administrator taxonomy ──
const V10_DOMAINS = [
  {
    code: 'A-D1',
    nameTh: 'การบริหารวิชาการและความเป็นผู้นำทางวิชาการ',
    sortOrder: 1,
    part: 'standards',
    indicators: [
      ['A-1.1', 'การวางแผนพัฒนามาตรฐานการเรียนรู้ของผู้เรียน', 1],
      ['A-1.2', 'การจัดทำและพัฒนาหลักสูตรสถานศึกษา', 2],
      ['A-1.3', 'การพัฒนากระบวนการจัดการเรียนรู้ที่เน้นผู้เรียนเป็นสำคัญและปฏิบัติการสอน', 3],
      ['A-1.4', 'การส่งเสริม สนับสนุน การพัฒนาหรือการนำสื่อ นวัตกรรม และเทคโนโลยีทางการศึกษามาใช้', 4],
      ['A-1.5', 'การนิเทศ กำกับ ติดตาม ประเมินผลการจัดการเรียนรู้ และการประกันคุณภาพภายใน', 5],
      ['A-1.6', 'การศึกษา วิเคราะห์ เพื่อแก้ปัญหาและพัฒนาการจัดการเรียนรู้', 6],
    ],
  },
  {
    code: 'A-D2',
    nameTh: 'การบริหารจัดการสถานศึกษา',
    sortOrder: 2,
    part: 'standards',
    indicators: [
      ['A-2.1', 'การบริหารจัดการสถานศึกษาตามกฎหมาย ระเบียบ ข้อบังคับ นโยบาย และหลักบริหารกิจการบ้านเมืองที่ดี', 1],
      ['A-2.2', 'การบริหารกิจการผู้เรียนและการส่งเสริมพัฒนาผู้เรียน', 2],
      ['A-2.3', 'การจัดระบบดูแลช่วยเหลือผู้เรียน', 3],
    ],
  },
  {
    code: 'A-D3',
    nameTh: 'การบริหารการเปลี่ยนแปลงเชิงกลยุทธ์และนวัตกรรม',
    sortOrder: 3,
    part: 'standards',
    indicators: [
      ['A-3.1', 'การกำหนดนโยบาย กลยุทธ์ การใช้เครื่องมือหรือนวัตกรรมทางการบริหาร', 1],
      ['A-3.2', 'การบริหารการเปลี่ยนแปลงและนวัตกรรม', 2],
    ],
  },
  {
    code: 'A-D4',
    nameTh: 'การบริหารงานชุมชนและเครือข่าย',
    sortOrder: 4,
    part: 'standards',
    indicators: [
      ['A-4.1', 'การสร้างและพัฒนาเครือข่ายเพื่อพัฒนาการเรียนรู้', 1],
      ['A-4.2', 'การจัดระบบการให้บริการในสถานศึกษา', 2],
    ],
  },
  {
    code: 'A-D5',
    nameTh: 'การพัฒนาตนเองและวิชาชีพ',
    sortOrder: 5,
    part: 'standards',
    indicators: [
      ['A-5.1', 'การพัฒนาตนเองและวิชาชีพ', 1],
      ['A-5.2', 'การนำความรู้ ทักษะที่ได้จากการพัฒนาตนเองมาใช้', 2],
    ],
  },
  {
    code: 'A-C',
    nameTh: 'ประเด็นท้าทายในการพัฒนาคุณภาพผู้เรียน ครู และสถานศึกษา',
    sortOrder: 6,
    part: 'challenge',
    indicators: [
      // Same 20/10/10 split as teachers (evaluation-framework.md); codes are data, not schema.
      ['A-C.1', 'วิธีดำเนินการ', 1, 20],
      ['A-C.2.1', 'ผลลัพธ์เชิงปริมาณ', 2, 10],
      ['A-C.2.2', 'ผลลัพธ์เชิงคุณภาพ', 3, 10],
    ],
  },
  {
    code: 'A-W',
    nameTh: 'ภาระงาน (เกณฑ์ผ่าน/ไม่ผ่าน)',
    sortOrder: 0,
    part: 'standards',
    indicators: [
      ['A-W.1', 'ภาระงานตามมาตรฐานตำแหน่ง', 0, null, 'workload_gate'],
    ],
  },
];

/**
 * @param {string} frameworkId
 * @param {typeof V9_DOMAINS} domains
 */
async function seedDomainsAndIndicators(frameworkId, domains) {
  for (const d of domains) {
    const domain = await prisma.evaluationDomain.upsert({
      where: {
        frameworkVersionId_code: {
          frameworkVersionId: frameworkId,
          code: d.code,
        },
      },
      create: {
        frameworkVersionId: frameworkId,
        code: d.code,
        nameTh: d.nameTh,
        sortOrder: d.sortOrder,
        part: d.part,
      },
      update: {
        nameTh: d.nameTh,
        sortOrder: d.sortOrder,
        part: d.part,
      },
    });

    for (const row of d.indicators) {
      const [code, nameTh, sortOrder, maxPoints = null, kind = null] = row;
      const indicatorKind =
        kind === 'workload_gate'
          ? 'workload_gate'
          : d.part === 'challenge'
            ? 'challenge'
            : 'standard';
      const isScored = indicatorKind !== 'workload_gate';

      await prisma.indicator.upsert({
        where: {
          frameworkVersionId_code: {
            frameworkVersionId: frameworkId,
            code,
          },
        },
        create: {
          domainId: domain.id,
          frameworkVersionId: frameworkId,
          code,
          nameTh,
          sortOrder,
          isScored,
          indicatorKind,
          maxPoints: maxPoints == null ? null : maxPoints,
        },
        update: {
          domainId: domain.id,
          nameTh,
          sortOrder,
          isScored,
          indicatorKind,
          maxPoints: maxPoints == null ? null : maxPoints,
        },
      });
    }
  }
}

async function seedFramework({ code, roleFamily, legalRef, revisionYear, domains }) {
  const fw = await prisma.frameworkVersion.upsert({
    where: { code },
    create: {
      code,
      roleFamily,
      legalRef,
      revisionYear,
      status: 'active',
      effectiveFrom: new Date('2021-05-20'),
    },
    update: {
      roleFamily,
      legalRef,
      revisionYear,
      status: 'active',
    },
  });

  for (const w of SCORE_WEIGHTS) {
    await prisma.scoreWeight.upsert({
      where: {
        frameworkVersionId_weightKey: {
          frameworkVersionId: fw.id,
          weightKey: w.weightKey,
        },
      },
      create: {
        frameworkVersionId: fw.id,
        weightKey: w.weightKey,
        weightValue: w.weightValue,
        notes: w.notes,
      },
      update: {
        weightValue: w.weightValue,
        notes: w.notes,
      },
    });
  }

  await seedDomainsAndIndicators(fw.id, domains);
  return fw;
}

async function main() {
  for (const r of RANK_LEVELS) {
    await prisma.rankLevel.upsert({
      where: { code: r.code },
      create: r,
      update: {
        roleFamily: r.roleFamily,
        labelTh: r.labelTh,
        sortOrder: r.sortOrder,
      },
    });
  }

  for (const c of EVIDENCE_CATEGORIES) {
    await prisma.evidenceCategory.upsert({
      where: { code: c.code },
      create: c,
      update: {
        labelTh: c.labelTh,
        allowedMimeTypes: c.allowedMimeTypes,
        maxByteSize: c.maxByteSize,
        maxDurationSeconds: c.maxDurationSeconds,
        requiredForDpa: c.requiredForDpa,
      },
    });
  }

  const v9 = await seedFramework({
    code: 'v9-2564-teacher',
    roleFamily: 'teacher',
    legalRef: 'ศธ 0206.3/ว 9 ลว. 20 พ.ค. 2564',
    revisionYear: 2564,
    domains: V9_DOMAINS,
  });

  const v10 = await seedFramework({
    code: 'v10-2564-administrator',
    roleFamily: 'administrator',
    legalRef: 'ศธ 0206.3/ว 10 ลว. 20 พ.ค. 2564',
    revisionYear: 2564,
    domains: V10_DOMAINS,
  });

  // SEIP-DB-003: every scored indicator × rank tier × rubric 1..4
  const v9Levels = await seedLevelDescriptionsForFramework(prisma, {
    frameworkId: v9.id,
    legalRef: 'ศธ 0206.3/ว 9 ลว. 20 พ.ค. 2564',
    rankCodes: TEACHER_RANK_CODES,
  });
  const v10Levels = await seedLevelDescriptionsForFramework(prisma, {
    frameworkId: v10.id,
    legalRef: 'ศธ 0206.3/ว 10 ลว. 20 พ.ค. 2564',
    rankCodes: ADMIN_RANK_CODES,
  });

  const counts = {
    rankLevels: await prisma.rankLevel.count(),
    evidenceCategories: await prisma.evidenceCategory.count(),
    frameworks: await prisma.frameworkVersion.count(),
    domains: await prisma.evaluationDomain.count(),
    indicators: await prisma.indicator.count(),
    weights: await prisma.scoreWeight.count(),
    levelDescriptions: await prisma.indicatorLevelDescription.count(),
    v9Indicators: await prisma.indicator.count({ where: { frameworkVersionId: v9.id } }),
    v10Indicators: await prisma.indicator.count({ where: { frameworkVersionId: v10.id } }),
    v9LevelRows: v9Levels.written,
    v10LevelRows: v10Levels.written,
  };

  console.log('seed OK', counts);
  // Expected: 15 standard + 3 challenge + 1 workload per role = 19 each.
  if (counts.v9Indicators !== 19 || counts.v10Indicators !== 19) {
    throw new Error(
      `unexpected indicator counts: v9=${counts.v9Indicators} v10=${counts.v10Indicators} (want 19 each)`,
    );
  }
  // 18 scored × 6 ranks × 4 levels = 432; 18 × 5 × 4 = 360
  if (v9Levels.written !== 432 || v10Levels.written !== 360) {
    throw new Error(
      `unexpected level-description counts: v9=${v9Levels.written} v10=${v10Levels.written} (want 432 and 360)`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
