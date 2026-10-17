// P5 (ADR-0017): a teacher exports their portfolio; the worker builds the zip
// and the page offers the download once it is ready.
import { test, expect } from '@playwright/test';
import { expectLoggedInShell, loadE2eCreds, login, type E2eCreds } from './helpers';

let creds: E2eCreds;
test.beforeAll(() => { creds = loadE2eCreds(); });

test('teacher requests a portfolio export and gets a download once the worker builds it', async ({ page }) => {
  await login(page, creds.teacher.email, creds.teacher.password);
  await expectLoggedInShell(page);
  await page.getByRole('link', { name: 'ส่งออก', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ส่งออกแฟ้มผลงาน' })).toBeVisible();
  await page.getByRole('button', { name: 'สร้างไฟล์ส่งออกแฟ้มผลงาน' }).click();
  const list = page.getByRole('list', { name: 'รายการไฟล์ส่งออก' });
  const first = list.getByRole('listitem').first();
  await expect(first).toContainText(/รอคิว|กำลังจัดทำ|พร้อมดาวน์โหลด/);
  // The page polls while the package is queued/building.
  await expect(first.getByRole('button', { name: 'ดาวน์โหลด' })).toBeVisible({ timeout: 30_000 });
});
