// FR-014: a teacher drops several files at once; each becomes its own evidence
// item, with progress and a status per file.
import { test, expect } from '@playwright/test';
import { expectLoggedInShell, loadE2eCreds, login, type E2eCreds } from './helpers';

let creds: E2eCreds;
test.beforeAll(() => { creds = loadE2eCreds(); });

test('teacher sends two PDFs in one go and gets one item per file', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, creds.teacher.email, creds.teacher.password);
  await expectLoggedInShell(page);
  await page.getByRole('link', { name: 'ส่งหลายไฟล์' }).click();
  await expect(page.getByRole('heading', { name: 'ส่งหลักฐานหลายไฟล์' })).toBeVisible();

  const category = page.locator('#batch-category');
  await expect(category.locator('option')).not.toHaveCount(1, { timeout: 15_000 });
  const pdfCapable = await category.locator('option').evaluateAll((opts) =>
    opts.map((o) => ({ value: (o as HTMLOptionElement).value, text: o.textContent ?? '' })));
  const plan = pdfCapable.find((o) => /แผนการจัดการเรียนรู้/.test(o.text)) ?? pdfCapable[1];
  await category.selectOption(plan.value);

  const stamp = Date.now();
  const pdf = (n: number) => ({
    name: `e2e-batch-${stamp}-${n}.pdf`, mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.4\n% batch ${stamp} ${n}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`),
  });
  await page.locator('#batch-files').setInputFiles([pdf(1), pdf(2)]);
  const list = page.getByRole('list', { name: 'ไฟล์ที่จะส่ง' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByText('รอส่ง')).toHaveCount(2);

  await page.getByRole('button', { name: 'ส่ง 2 ไฟล์' }).click();
  await expect(list.getByText(/ส่งแล้ว/)).toHaveCount(2, { timeout: 45_000 });
  await expect(list.getByRole('link', { name: 'เปิดหลักฐาน' })).toHaveCount(2);

  // Each file is its own item, titled after the file.
  await list.getByRole('link', { name: 'เปิดหลักฐาน' }).first().click();
  await expect(page.getByRole('heading', { name: `e2e-batch-${stamp}-1` })).toBeVisible();
});
