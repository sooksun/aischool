// P3 extract (plan §3 step 2), the Node floor: the text layer of a PDF, page by
// page, with pdf.js. Nothing is rendered, no font is loaded and PDF scripts
// never run (pdf.js executes no document JavaScript outside a viewer sandbox). A scanned PDF has no text layer and
// yields empty pages; OCR (Typhoon OCR on the in-country GPU) fills those later.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export const PDF_MAX_PAGES = 300;
const PAGE_TEXT_MAX = 20_000;

/** FR-028: below this font size (PDF units ≈ pt) text cannot be read on the page. */
const TINY_FONT = 2;

export async function pdfPageTexts(bytes: Uint8Array): Promise<{ page: number; text: string; tinyChars: number }[]> {
  const task = getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false, stopAtErrors: false });
  const doc = await task.promise;
  try {
    const out: { page: number; text: string; tinyChars: number }[] = [];
    const n = Math.min(doc.numPages, PDF_MAX_PAGES);
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = '';
      let tinyChars = 0;
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str + (item.hasEOL ? '\n' : '');
        const [, , c, d] = item.transform as number[];
        if (Math.hypot(c, d) < TINY_FONT) tinyChars += item.str.trim().length;
      }
      // Control characters (NUL among them) are not text and PostgreSQL refuses NUL.
      // eslint-disable-next-line no-control-regex
      text = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').normalize('NFC').replace(/[ \t]+/g, ' ').trim().slice(0, PAGE_TEXT_MAX);
      out.push({ page: i, text, tinyChars });
      page.cleanup();
    }
    return out;
  } finally {
    await task.destroy();
  }
}
