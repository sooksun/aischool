// FR-028 (v0, rules only): signs that an item tries to steer the AI rather than
// show work. The person being evaluated is the main threat (PRD), so the signals
// are about intent to influence a reader that is a machine:
//   hidden_characters  zero-width / bidi control characters in the text
//   instruction_text   wording addressed to an AI or asking for a score/mapping
//   tiny_text          text too small to read on the page (PDF font < 2 pt)
// A flag never changes a mapping or a score. It only removes the item's
// suggestions from batch accept and shows a badge (CCR-027). The comparison of
// the text layer against an OCR of the rendered page arrives with the GPU tier.

export type InjectionReason = 'hidden_characters' | 'instruction_text' | 'tiny_text';

// eslint-disable-next-line no-misleading-character-class
const HIDDEN = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
const HIDDEN_MIN = 3;
const TINY_MIN_CHARS = 20;

const INSTRUCTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above)\s+instructions?/i,
  /disregard\s+(?:the\s+)?(?:previous|prior|above|system)/i,
  /system\s+prompt/i,
  /you\s+are\s+(?:an?\s+)?(?:ai|assistant|language\s+model|chatgpt|llm)/i,
  /(?:as|to)\s+the\s+(?:ai|assistant|model)\b/i,
  /(?:give|assign|rate|score)\s+(?:this|me|it)\s+(?:a\s+)?(?:score|level|grade|rating)/i,
  /map\s+(?:this|it)\s+to\s+(?:all|every)\s+indicators?/i,
  /(?:ละเว้น|ไม่ต้องสนใจ|ข้าม|เพิกเฉย)\s*(?:ต่อ)?\s*คำสั่ง/,
  /คำสั่ง(?:ก่อนหน้า|ของระบบ|ระบบ)/,
  /(?:ถึง|สำหรับ)\s*(?:ระบบ\s*)?(?:AI|เอไอ|ปัญญาประดิษฐ์)/i,
  /(?:ให้|จง)\s*(?:คะแนน|ระดับ)\s*(?:เต็ม|สูงสุด|[4๔])/,
  /(?:จับคู่|ผูก)\s*(?:กับ)?\s*(?:ทุก|ทั้งหมด)\s*ตัวชี้วัด/,
  /ผ่าน\s*ทุก\s*ตัวชี้วัด/,
];

export function detectInjection(input: { texts: string[]; tinyTextChars?: number }): InjectionReason[] {
  const reasons: InjectionReason[] = [];
  const all = input.texts.join('\n');
  if ((all.match(HIDDEN) ?? []).length >= HIDDEN_MIN) reasons.push('hidden_characters');
  const visible = all.replace(HIDDEN, '');
  if (INSTRUCTION_PATTERNS.some((re) => re.test(visible))) reasons.push('instruction_text');
  if ((input.tinyTextChars ?? 0) >= TINY_MIN_CHARS) reasons.push('tiny_text');
  return reasons;
}
