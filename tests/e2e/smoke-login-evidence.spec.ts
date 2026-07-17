// Shell-level smoke (SEIP-QA-004) — login + role nav. Deeper flows in flows-*.spec.ts (L2).
import { test, expect } from '@playwright/test';
import { expectLoggedInShell, loadE2eCreds, login, type E2eCreds } from './helpers';

let creds: E2eCreds;
test.beforeAll(() => { creds = loadE2eCreds(); });

test.describe('smoke: teacher evidence', () => {
  test('teacher can log in and open evidence list', async ({ page }) => {
    await login(page, creds.teacher.email, creds.teacher.password);
    await expectLoggedInShell(page);
    await expect(page.getByRole('link', { name: 'ส่งหลักฐานใหม่' })).toBeVisible();
  });

  test('teacher can open new evidence form (pick step)', async ({ page }) => {
    await login(page, creds.teacher.email, creds.teacher.password);
    await expectLoggedInShell(page);
    await page.getByRole('link', { name: 'ส่งหลักฐานใหม่' }).click();
    await expect(page).toHaveURL(/\/evidence\/new/);
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 });
  });

  test('teacher can open reports list (own scope)', async ({ page }) => {
    await login(page, creds.teacher.email, creds.teacher.password);
    await expectLoggedInShell(page);
    await page.getByRole('link', { name: 'รายงาน PA' }).click();
    await expect(page).toHaveURL(/\/reports/);
    await expect(page.getByRole('heading', { name: /รายงาน/ })).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('smoke: director shell', () => {
  test('director reaches cycle management and reports', async ({ page }) => {
    await login(page, creds.director.email, creds.director.password);
    await expect(page.getByRole('link', { name: 'จัดการรอบการประเมิน' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('link', { name: 'จัดการรอบการประเมิน' }).click();
    await expect(page).toHaveURL(/\/director\/cycles/);
    await expect(page.getByRole('heading', { name: /รอบการประเมิน/ })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('link', { name: 'รายงาน PA' }).click();
    await expect(page).toHaveURL(/\/reports/);
    await expect(page.getByRole('heading', { name: /รายงาน/ })).toBeVisible({ timeout: 15_000 });
  });

  test('director sees งานกรรมการ nav (chair path)', async ({ page }) => {
    await login(page, creds.director.email, creds.director.password);
    await expect(page.getByRole('link', { name: 'งานกรรมการ' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('link', { name: 'งานกรรมการ' }).click();
    await expect(page).toHaveURL(/\/evaluator/);
    await expect(page.getByRole('heading', { name: /กรรมการ/ })).toBeVisible({ timeout: 15_000 });
  });
});
