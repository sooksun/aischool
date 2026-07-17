import { describe, expect, it } from 'vitest';
import {
  REPORT_LIST_FIDELITY_HINT,
  REPORT_PDF_DOWNLOAD_LABEL,
  REPORT_PDF_FIDELITY_NOTE,
} from './reportPdfCopy';

describe('report PDF fidelity copy (L1)', () => {
  it('download label does not claim official form', () => {
    expect(REPORT_PDF_DOWNLOAD_LABEL).not.toMatch(/อย่างเป็นทางการ/);
    expect(REPORT_PDF_DOWNLOAD_LABEL).toMatch(/ร่าง|ตรวจ/);
  });

  it('list and detail notes deny official ก.ค.ศ. plate', () => {
    for (const text of [REPORT_LIST_FIDELITY_HINT, REPORT_PDF_FIDELITY_NOTE]) {
      expect(text).toMatch(/ก\.ค\.ศ|อย่างเป็นทางการ/);
      expect(text).toMatch(/ไม่ใช่|ยังไม่ใช่/);
    }
  });
});
