// Framework taxonomy — read-only, versioned reference data (ADR-0003). No
// tenancy filter: frameworks are global, not school-owned.
import { prisma } from '../client.js';
import type { RoleFamily, FrameworkStatus } from '@prisma/client';

export async function listFrameworks(filter: { roleFamily?: RoleFamily; status?: FrameworkStatus }) {
  return prisma.frameworkVersion.findMany({
    where: {
      roleFamily: filter.roleFamily,
      status: filter.status,
    },
    orderBy: { revisionYear: 'desc' },
  });
}

export async function getFrameworkById(frameworkId: string) {
  return prisma.frameworkVersion.findUnique({ where: { id: frameworkId } });
}

/**
 * Framework + domain -> indicator tree. `includeLevels` gates the per-rank rubric
 * text (openapi.yaml: "request them explicitly with include=levels" — the payload
 * is large, so callers opt in rather than paying for it on every list).
 */
export async function getFrameworkDetail(frameworkId: string, includeLevels: boolean) {
  const framework = await prisma.frameworkVersion.findUnique({
    where: { id: frameworkId },
    include: {
      weights: true,
      domains: {
        orderBy: { sortOrder: 'asc' },
        include: {
          indicators: {
            orderBy: { sortOrder: 'asc' },
            include: includeLevels ? { levelDescriptions: true } : undefined,
          },
        },
      },
    },
  });
  return framework;
}

export async function listEvidenceCategories() {
  return prisma.evidenceCategory.findMany({ orderBy: { code: 'asc' } });
}

export async function getEvidenceCategoryById(categoryId: string) {
  return prisma.evidenceCategory.findUnique({ where: { id: categoryId } });
}

export async function getIndicatorById(indicatorId: string) {
  return prisma.indicator.findUnique({ where: { id: indicatorId } });
}
