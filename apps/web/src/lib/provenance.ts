// FR-047: every confirmed mapping says where it came from — the same words for
// the owner, the director and the committee. Never a confidence or a rationale
// (FR-061): only whether the AI proposed it.
import type { components } from '../api/schema.generated';

export function provenanceLabel(source: components['schemas']['MappingSource']): string {
  return source === 'ai_accepted' ? 'AI เสนอ · ยืนยันโดยเจ้าของ' : 'เจ้าของเพิ่มเอง';
}
