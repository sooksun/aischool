// Read-only versioned taxonomy (ADR-0003). Every authenticated role can read it
// (permissions.yaml: teacher..area_admin all get school/area-r) — no ownership
// check needed, just authentication (handled by the global preHandler).
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { listFrameworks, getFrameworkDetail, listEvidenceCategories } from '@seip/database';
import { ApiError } from '@seip/backend-shared';

export const taxonomyRoutes: FastifyPluginAsync = async (app) => {
  app.get('/frameworks', { config: { operationId: 'listFrameworks' } }, async (request) => {
    const q = z.object({
      role_family: z.enum(['teacher', 'administrator']).optional(),
      status: z.enum(['active', 'superseded', 'draft']).optional(),
    }).parse(request.query);

    const rows = await listFrameworks({ roleFamily: q.role_family, status: q.status });
    return rows.map((f) => ({
      id: f.id, code: f.code, role_family: f.roleFamily, legal_ref: f.legalRef,
      revision_year: f.revisionYear, status: f.status,
    }));
  });

  app.get('/frameworks/:frameworkId', { config: { operationId: 'getFramework' } }, async (request) => {
    const params = z.object({ frameworkId: z.string().uuid() }).parse(request.params);
    const q = z.object({ include: z.string().optional() }).parse(request.query);
    const includeLevels = (q.include ?? '').split(',').includes('levels');

    const fw = await getFrameworkDetail(params.frameworkId, includeLevels);
    if (!fw) throw new ApiError('RES-001', 'Framework not found');

    return {
      id: fw.id, code: fw.code, role_family: fw.roleFamily, legal_ref: fw.legalRef,
      revision_year: fw.revisionYear, status: fw.status,
      score_weights: fw.weights.map((w) => ({ weight_key: w.weightKey, weight_value: Number(w.weightValue) })),
      domains: fw.domains.map((d) => ({
        id: d.id, code: d.code, name_th: d.nameTh, sort_order: d.sortOrder, part: d.part,
        indicators: d.indicators.map((i) => ({
          id: i.id, code: i.code, name_th: i.nameTh, sort_order: i.sortOrder,
          is_scored: i.isScored, indicator_kind: i.indicatorKind,
          ...(includeLevels
            ? { levels: (i as unknown as { levelDescriptions: { rankLevelCode: string; rubricLevel: number; expectedPracticeTh: string }[] }).levelDescriptions.map((l) => ({
                rank_level_code: l.rankLevelCode, rubric_level: l.rubricLevel, expected_practice_th: l.expectedPracticeTh,
              })) }
            : {}),
        })),
      })),
    };
  });

  app.get('/evidence-categories', { config: { operationId: 'listEvidenceCategories' } }, async () => {
    const rows = await listEvidenceCategories();
    return rows.map((c) => ({
      id: c.id, code: c.code, label_th: c.labelTh, allowed_mime_types: c.allowedMimeTypes,
      max_byte_size: c.maxByteSize ? Number(c.maxByteSize) : null,
      max_duration_seconds: c.maxDurationSeconds, required_for_dpa: c.requiredForDpa,
    }));
  });
};
