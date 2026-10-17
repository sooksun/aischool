// FR-054: the teacher narrows "หลักฐานของฉัน" with the filter bar; a filter that
// matches nothing says so (not the first-run empty state), and clearing restores the list.
import { test, expect } from '@playwright/test';
import { expectLoggedInShell, loadE2eCreds, login, type E2eCreds } from './helpers';

let creds: E2eCreds;
test.beforeAll(() => { creds = loadE2eCreds(); });

test('teacher searches and filters the portfolio, then clears the filters', async ({ page }) => {
  await login(page, creds.teacher.email, creds.teacher.password);
  await expectLoggedInShell(page);
  const cards = page.locator('a.evidence-card');
  await expect(cards.first()).toBeVisible({ timeout: 15_000 });
  const before = await cards.count();

  const form = page.getByRole('form', { name: 'ค้นหาและกรองหลักฐาน' });
  await form.getByLabel('ค้นหาชื่อ').fill(`ไม่มีชื่อนี้-${Date.now()}`);
  await form.getByRole('button', { name: 'ค้นหา' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'ไม่พบหลักฐานที่ตรงกับตัวกรอง' })).toBeVisible();
  await expect(page.getByText('ยังไม่มีหลักฐาน', { exact: true })).toHaveCount(0);

  await form.getByRole('button', { name: 'ล้างตัวกรอง' }).click();
  await expect(cards).toHaveCount(before);

  await form.getByLabel('การผูกตัวชี้วัด').selectOption('validated');
  await form.getByRole('button', { name: 'ค้นหา' }).click();
  await expect(async () => {
    expect(await cards.count()).toBeLessThanOrEqual(before);
  }).toPass();
});
