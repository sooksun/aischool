// FR-023a: personal data out of evidence text before it reaches a model, a
// quote that others read, or a segment shown to anyone but the owner. Rules
// only — no model, no network. Thai digits (๐–๙) count as digits. Names of
// learners need an in-country NER model and are not covered here yet.
//
// Masks keep the text readable for the mapper: a placeholder per kind, so a
// quote still reads "โทร [เบอร์โทร]" rather than vanishing.

export type PiiKind = 'national_id' | 'phone' | 'email';

export const PII_MASK: Record<PiiKind, string> = {
  national_id: '[เลขบัตรประชาชน]',
  phone: '[เบอร์โทร]',
  email: '[อีเมล]',
};

const D = '[0-9๐-๙]';
const SEP = '[\\s\\-.]?';

// 13 digits, plain or grouped 1-2345-67890-12-3 (any of space, dash or dot).
const NATIONAL_ID = new RegExp(`(?<!${D})${D}${SEP}${D}{4}${SEP}${D}{5}${SEP}${D}{2}${SEP}${D}(?!${D})`, 'g');
// Mobile 06/08/09 + 8 digits, landline 02–07 + 7 digits, or +66 without the 0.
const PHONE = new RegExp(
  `(?<!${D})(?:(?:\\+66|0066)${SEP}[1-9]|[0๐][0-9๐-๙])(?:${SEP}${D}){7,8}(?!${D})`,
  'g',
);
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;

export interface Redaction {
  text: string;
  counts: Record<PiiKind, number>;
}

/** Replace national ids, phone numbers and emails; ids first, so a 13-digit id is never half-read as a phone. */
export function redactPii(text: string): Redaction {
  const counts: Record<PiiKind, number> = { national_id: 0, phone: 0, email: 0 };
  let out = text.replace(EMAIL, () => { counts.email++; return PII_MASK.email; });
  out = out.replace(NATIONAL_ID, () => { counts.national_id++; return PII_MASK.national_id; });
  out = out.replace(PHONE, () => { counts.phone++; return PII_MASK.phone; });
  return { text: out, counts };
}
