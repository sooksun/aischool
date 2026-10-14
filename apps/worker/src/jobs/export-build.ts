// P5 export.build (ADR-0017). portfolio_portable: a zip of the person's whole
// accepted portfolio — every scanned original as uploaded, plus manifest.json
// (items, files with SHA-256, indicator mappings and their state) and a Thai
// README. Built in a private temp dir, hashed while written, uploaded to object
// storage, and kept for EXPORT_TTL_MS. Nothing leaves the storage boundary.
import type { S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import yazl from 'yazl';
import {
  getExportById, getPortfolioForExport, markExportBuilding, markExportReady, markExportFailed,
} from '@seip/database';
import { getObjectStream, putObjectFromFile } from '../s3.js';
import type { Env } from '../env.js';

export interface ExportBuildPayload { export_id: string }

/** A file or folder name that survives every OS and zip tool; Thai is kept. */
export function safeName(name: string, max = 80): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.normalize('NFC').replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return (cleaned || 'ไม่มีชื่อ').slice(0, max).trim();
}

const README_TH = `ชุดข้อมูลหลักฐานของฉัน (SEIP)

- โฟลเดอร์ evidence/ มีหลักฐานแต่ละชิ้นเป็นโฟลเดอร์ ภายในคือไฟล์ต้นฉบับตามที่อัปโหลด
- manifest.json อธิบายหลักฐานทุกชิ้น: ชื่อ ประเภท วันที่ปฏิบัติงาน ลิงก์/บันทึก
  ไฟล์ (พร้อมค่า SHA-256 ไว้ตรวจว่าไฟล์ไม่ถูกแก้) และตัวชี้วัดที่ผูกไว้พร้อมสถานะ
- ไฟล์ที่ระบบกักไว้หรือยังตรวจไม่เสร็จจะไม่อยู่ในชุดนี้
- ชุดข้อมูลนี้มีข้อมูลส่วนบุคคล โปรดเก็บรักษาอย่างปลอดภัย
`;

export async function processExportBuild(env: Env, s3: S3Client, payload: ExportBuildPayload): Promise<void> {
  const exp = await getExportById(payload.export_id);
  if (!exp || !(await markExportBuilding(exp.id))) return; // gone, or already built by another run
  if (exp.kind !== 'portfolio_portable') {
    await markExportFailed(exp.id, [{ code: 'EXP-001', message_th: 'ยังไม่รองรับชุดส่งออกประเภทนี้', severity: 'error', rule_verified: true }]);
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), 'seip-export-'));
  try {
    const items = await getPortfolioForExport(exp.personId);
    const zip = new yazl.ZipFile();
    const out = join(dir, 'export.zip');
    const written = new Promise<void>((resolve, reject) => {
      zip.outputStream.pipe(createWriteStream(out)).on('close', resolve).on('error', reject);
    });

    const used = new Set<string>();
    const manifestItems = [];
    for (const [n, ev] of items.entries()) {
      let folder = `evidence/${String(n + 1).padStart(3, '0')} ${safeName(ev.title)}`;
      while (used.has(folder)) folder += '_';
      used.add(folder);
      const files = [];
      for (const f of ev.files) {
        let path = `${folder}/${safeName(f.originalFilename, 120)}`;
        while (used.has(path)) path = path.replace(/(\.[^.]*)?$/, (ext) => `_${ext}`);
        used.add(path);
        zip.addReadStream((await getObjectStream(s3, env.S3_BUCKET, f.storageUri)) as Readable, path, { compress: false });
        files.push({ path, filename: f.originalFilename, content_type: f.contentType, byte_size: Number(f.byteSize), sha256: f.checksumSha256 });
      }
      manifestItems.push({
        id: ev.id, kind: ev.kind, title: ev.title, description: ev.description,
        category: ev.category ? { code: ev.category.code, label_th: ev.category.labelTh } : null,
        link_url: ev.linkUrl, note_text: ev.noteText,
        performed_from: ev.performedFrom?.toISOString().slice(0, 10) ?? null,
        performed_to: ev.performedTo?.toISOString().slice(0, 10) ?? null,
        created_at: ev.createdAt.toISOString(),
        files,
        mappings: ev.mappings.map((m) => ({
          indicator_code: m.indicator.code, indicator_name_th: m.indicator.nameTh, status: m.status, source: m.mappingSource,
          framework_version_id: m.frameworkVersionId, owner_confirmed_at: m.ownerConfirmedAt.toISOString(),
        })),
      });
    }
    const manifest = { schema: 'seip.portfolio_portable', schema_version: 1, exported_at: new Date().toISOString(), person_id: exp.personId, items: manifestItems };
    zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), 'manifest.json');
    zip.addBuffer(Buffer.from(README_TH, 'utf8'), 'README.txt');
    zip.end();
    await written;

    const hash = createHash('sha256');
    for await (const chunk of createReadStream(out)) hash.update(chunk as Buffer);
    const key = `exports/${exp.personId}/${exp.id}.zip`;
    await putObjectFromFile(s3, env.S3_BUCKET, key, out, 'application/zip');
    await markExportReady(exp.id, { storageUri: key, byteSize: BigInt((await stat(out)).size), sha256: hash.digest('hex'), preflight: [] });
  } catch (e) {
    console.warn(`[export.build] ${exp.id} failed: ${(e as Error).name}`);
    await markExportFailed(exp.id, [{ code: 'SYS-001', message_th: 'สร้างชุดส่งออกไม่สำเร็จ ลองใหม่อีกครั้ง', severity: 'error', rule_verified: true }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
