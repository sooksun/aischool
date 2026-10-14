// P5 exports (ADR-0017). An export is queued with its worker job, built into
// object storage by the worker, and kept for EXPORT_TTL_MS; after that it is
// expired and its object removed. Only server-verified, scanned files go in.
import type { ExportKind, Prisma } from '@prisma/client';
import { prisma } from '../client.js';
import { enqueueWorkerJob } from './jobs.js';
import { enqueueOutboxEvent } from './outbox.js';

export const EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function queueExport(input: { kind: ExportKind; personId: string; schoolId: string; requestedByUserId: string }) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.exportPackage.create({ data: input });
    await enqueueWorkerJob({ jobType: 'export.build', payload: { export_id: row.id } }, tx);
    return row;
  });
}

export async function getExportById(id: string) {
  return prisma.exportPackage.findUnique({ where: { id } });
}

/** The caller's own exports, plus — for school-wide roles — exports requested at those schools. */
export async function listExportsFor(personId: string | null, schoolIds: string[], f: { offset: number; limit: number }) {
  const or: Prisma.ExportPackageWhereInput[] = [];
  if (personId) or.push({ personId });
  if (schoolIds.length) or.push({ schoolId: { in: schoolIds } });
  if (or.length === 0) return { items: [], more: false };
  const rows = await prisma.exportPackage.findMany({ where: { OR: or }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: f.offset, take: f.limit + 1 });
  return { items: rows.slice(0, f.limit), more: rows.length > f.limit };
}

// ── worker side ──

/** A person's live, accepted portfolio with its scanned originals and live mappings. */
export async function getPortfolioForExport(personId: string) {
  return prisma.evidence.findMany({
    where: { ownerPersonId: personId, deletedAt: null, ownerAcceptedAt: { not: null } },
    orderBy: { createdAt: 'asc' },
    include: {
      files: { where: { role: 'original', scanStatus: { in: ['clean', 'unscanned', 'sanitised'] }, sha256VerifiedAt: { not: null } }, orderBy: { uploadedAt: 'asc' } },
      mappings: { where: { status: { not: 'revoked' } }, include: { indicator: { select: { code: true, nameTh: true } } } },
      category: { select: { code: true, labelTh: true } },
    },
  });
}

export async function markExportBuilding(id: string): Promise<boolean> {
  return (await prisma.exportPackage.updateMany({ where: { id, status: 'queued' }, data: { status: 'building' } })).count > 0;
}

export async function markExportReady(id: string, v: { storageUri: string; byteSize: bigint; sha256: string; preflight: Prisma.InputJsonValue }) {
  await prisma.$transaction(async (tx) => {
    const row = await tx.exportPackage.update({
      where: { id },
      data: { ...v, status: 'ready', finishedAt: new Date(), expiresAt: new Date(Date.now() + EXPORT_TTL_MS) },
    });
    await enqueueOutboxEvent({
      eventType: 'export.ready', schoolId: row.schoolId, actorUserId: null,
      payload: { export_id: row.id, kind: row.kind, person_id: row.personId },
    }, tx);
  });
}

export async function markExportFailed(id: string, preflight: Prisma.InputJsonValue, status: 'failed' | 'preflight_failed' = 'failed') {
  await prisma.exportPackage.updateMany({ where: { id }, data: { status, preflight, finishedAt: new Date() } });
}

/** Ready exports past their time: their objects are deleted by the caller, then they are marked expired. */
export async function listExpiredExports(now = new Date()) {
  return prisma.exportPackage.findMany({ where: { status: 'ready', expiresAt: { lt: now } }, select: { id: true, storageUri: true } });
}

export async function markExportExpired(id: string) {
  await prisma.exportPackage.update({ where: { id }, data: { status: 'expired', storageUri: null } });
}
