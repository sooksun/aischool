// FR-052: a teacher sees, per indicator, how much of their portfolio covers it.
import { test, expect } from '@playwright/test';
import { expectLoggedInShell, loadE2eCreds, login, type E2eCreds } from './helpers';

let creds: E2eCreds;
test.beforeAll(() => { creds = loadE2eCreds(); });

test('teacher opens indicator coverage and sees every ว9 indicator with its counts', async ({ page }) => {
  await login(page, creds.teacher.email, creds.teacher.password);
  await expectLoggedInShell(page);
  await page.getByRole('link', { name: 'ความครอบคลุม' }).click();
  await expect(page.getByRole('heading', { name: 'ความครอบคลุมตัวชี้วัด' })).toBeVisible();
  const table = page.getByRole('table', { name: 'ตัวชี้วัด' });
  await expect(table.getByRole('row').filter({ hasText: 'T-1.1' })).toBeVisible();
  await expect(table.getByRole('row').filter({ hasText: 'T-3.3' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText(/ตัวชี้วัด/);
});

test('the director can switch to the whole school (counts only)', async ({ page }) => {
  await login(page, creds.director.email, creds.director.password);
  await expectLoggedInShell(page);
  await page.getByRole('link', { name: 'ความครอบคลุม' }).click();
  await page.getByRole('radio', { name: 'ทั้งโรงเรียน' }).click();
  await expect(page.getByRole('status')).toContainText(/บุคลากร \d+ คน/);
});
