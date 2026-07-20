// Client-side mirror of UPL-001/002/003 — fail fast before bytes move (per
// field-contract-trace.md: "รู้ว่าวิดีโอยาวเกิน 10 นาที ก่อนเสียเวลาอัปโหลด").
// The server re-validates unconditionally (apps/api/src/routes/evidence.ts) —
// this is a UX courtesy, never the source of truth.
import type { components } from '../api/schema.generated';

type EvidenceCategory = components['schemas']['EvidenceCategory'];

export interface ValidationResult {
  ok: boolean;
  messageTh?: string;
}

export function validateFileAgainstCategory(file: File, category: EvidenceCategory): ValidationResult {
  if (!category.allowed_mime_types.includes(file.type)) {
    return { ok: false, messageTh: `ชนิดไฟล์ต้องเป็น: ${category.allowed_mime_types.join(', ')}` };
  }
  if (category.max_byte_size && file.size > category.max_byte_size) {
    const mb = Math.round(category.max_byte_size / (1024 * 1024));
    return { ok: false, messageTh: `ไฟล์มีขนาดใหญ่เกิน ${mb} MB` };
  }
  return { ok: true };
}

/** Reads video duration client-side via a hidden <video> element. Resolves null
 * if the browser can't determine it (e.g. unsupported codec) — the caller must
 * treat null as "unknown, let the server probe decide" per CCR-004, never as 0. */
export function readVideoDurationSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const url = URL.createObjectURL(file);
    video.src = url;
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(video.duration) ? Math.round(video.duration) : null);
    };
    video.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
  });
}

export function validateDuration(durationSeconds: number | null, category: EvidenceCategory): ValidationResult {
  if (!category.max_duration_seconds) return { ok: true };
  const min = Math.floor(category.max_duration_seconds / 60);

  // An unreadable duration can no longer be waved through: initiate rejects a
  // capped category with no declared duration (VAL-002), because the server has
  // no probe of its own to fall back on. Failing here keeps the reason specific —
  // VAL-002 alone renders as a generic "ข้อมูลไม่ถูกต้องตามเงื่อนไข".
  if (durationSeconds == null) {
    return { ok: false, messageTh: `ไม่สามารถอ่านความยาววิดีโอได้ (ต้องไม่เกิน ${min} นาที) — กรุณาแปลงไฟล์เป็น MP4/H.264 แล้วลองใหม่` };
  }
  if (durationSeconds > category.max_duration_seconds) {
    return { ok: false, messageTh: `วิดีโอต้องยาวไม่เกิน ${min} นาที` };
  }
  return { ok: true };
}

export async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
