import { describe, expect, it } from 'vitest';
import { provenanceLabel } from './provenance';

describe('provenanceLabel (FR-047)', () => {
  it('names the two origins in the PRD wording', () => {
    expect(provenanceLabel('ai_accepted')).toBe('AI เสนอ · ยืนยันโดยเจ้าของ');
    expect(provenanceLabel('manual')).toBe('เจ้าของเพิ่มเอง');
  });
});
