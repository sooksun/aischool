import { describe, test, expect } from 'vitest';
import { validateFileAgainstCategory, validateDuration, sha256Hex } from './fileValidation';
import type { components } from '../api/schema.generated';

type EvidenceCategory = components['schemas']['EvidenceCategory'];

const lessonPlanCategory: EvidenceCategory = {
  id: 'c1', code: 'lesson_plan', label_th: 'แผนการจัดการเรียนรู้',
  allowed_mime_types: ['application/pdf'], max_byte_size: 50 * 1024 * 1024,
  max_duration_seconds: null, required_for_dpa: true,
};

const inspirationVideoCategory: EvidenceCategory = {
  id: 'c2', code: 'inspiration_video', label_th: 'วิดีโอสภาพปัญหา',
  allowed_mime_types: ['video/mp4'], max_byte_size: 512 * 1024 * 1024,
  max_duration_seconds: 600, required_for_dpa: true, // ว9: <=10 minutes
};

function fakeFile(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('validateFileAgainstCategory', () => {
  test('accepts a matching mime type within size', () => {
    const result = validateFileAgainstCategory(fakeFile('x.pdf', 'application/pdf', 1024), lessonPlanCategory);
    expect(result.ok).toBe(true);
  });

  test('rejects a mismatched mime type (UPL-001 mirror)', () => {
    const result = validateFileAgainstCategory(fakeFile('x.docx', 'application/msword', 1024), lessonPlanCategory);
    expect(result.ok).toBe(false);
    expect(result.messageTh).toContain('ชนิดไฟล์');
  });

  test('rejects a file exceeding the category max size (UPL-002 mirror)', () => {
    const oversized = fakeFile('big.pdf', 'application/pdf', 51 * 1024 * 1024);
    const result = validateFileAgainstCategory(oversized, lessonPlanCategory);
    expect(result.ok).toBe(false);
    expect(result.messageTh).toContain('ขนาด');
  });
});

describe('validateDuration', () => {
  test('accepts a video under the category limit', () => {
    expect(validateDuration(300, inspirationVideoCategory).ok).toBe(true);
  });

  test('rejects a video over ว9\'s 10-minute limit (UPL-003 mirror)', () => {
    const result = validateDuration(700, inspirationVideoCategory);
    expect(result.ok).toBe(false);
    expect(result.messageTh).toContain('นาที');
  });

  test('null duration (unreadable client-side) is never rejected — CCR-002: server probe is authoritative', () => {
    expect(validateDuration(null, inspirationVideoCategory).ok).toBe(true);
  });

  test('a category with no duration limit never rejects', () => {
    expect(validateDuration(999999, lessonPlanCategory).ok).toBe(true);
  });
});

describe('sha256Hex', () => {
  test('produces a stable, deterministic 64-hex-char digest', async () => {
    const file = fakeFile('a.pdf', 'application/pdf', 10);
    const h1 = await sha256Hex(file);
    const h2 = await sha256Hex(file);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  test('different content produces a different digest', async () => {
    const a = new File([new Uint8Array([1, 2, 3])], 'a.pdf', { type: 'application/pdf' });
    const b = new File([new Uint8Array([4, 5, 6])], 'b.pdf', { type: 'application/pdf' });
    expect(await sha256Hex(a)).not.toBe(await sha256Hex(b));
  });
});
