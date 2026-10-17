// FR-117 (CCR-029): a teacher asks for a copy of their data; the DPO of the
// สพท. approves it; the request completes once the portfolio export is built.
import { test, expect } from '@playwright/test';
import { expectLoggedInShell, loadE2eCreds, login, type E2eCreds } from './helpers';

let creds: E2eCreds;
test.beforeAll(() => { creds = loadE2eCreds(); });

test('teacher files an access request; the DPO approves; the teacher sees it completed', async ({ page, browser }) => {
  const marker = `e2e-${Date.now()}`;
  await login(page, creds.teacher.email, creds.teacher.password);
  await expectLoggedInShell(page);
  await page.getByRole('link', { name: 'ข้อมูลส่วนบุคคล' }).click();
  await expect(page.getByRole('heading', { name: 'คำขอเกี่ยวกับข้อมูลส่วนบุคคลของฉัน' })).toBeVisible();
  await page.getByLabel('ประเภทคำขอ').selectOption('access');
  await page.getByLabel('รายละเอียด (ถ้ามี)').fill(marker);
  await page.getByRole('button', { name: 'ยื่นคำขอ' }).click();
  await expect(page.getByRole('status')).toContainText('ส่งคำขอแล้ว');

  // The DPO, in a separate browser: lands on the queue (no evidence list for this role).
  const dpoContext = await browser.newContext();
  const dpo = await dpoContext.newPage();
  await login(dpo, creds.dpo.email, creds.dpo.password);
  await expect(dpo.getByRole('heading', { name: 'คำขอใช้สิทธิของเจ้าของข้อมูล' })).toBeVisible({ timeout: 20_000 });
  await expect(dpo.getByRole('link', { name: 'หลักฐานของฉัน' })).toHaveCount(0);
  const item = dpo.getByRole('list', { name: 'คำขอ' }).getByRole('listitem').filter({ hasText: marker });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: 'อนุมัติและจัดทำไฟล์ข้อมูล' }).click();
  await expect(item).toHaveCount(0); // left the "received" filter
  await dpoContext.close();

  // The worker builds the export; the request completes and links to it.
  const mine = page.getByRole('list', { name: 'คำขอของฉัน' }).getByRole('listitem').first();
  await expect(async () => {
    await page.reload();
    await expect(mine).toContainText('เสร็จสิ้น', { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(mine.getByRole('link', { name: /ดาวน์โหลดไฟล์ข้อมูล/ })).toBeVisible();
});
