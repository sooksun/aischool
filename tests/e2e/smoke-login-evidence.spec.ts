// SEIP-QA-004 — browser smoke: login → evidence list → start submit flow → create draft path.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const creds = JSON.parse(readFileSync(resolve(__dirname, '.auth/e2e-user.json'), 'utf8')) as {
  email: string;
  password: string;
};

test.describe('smoke: login → evidence', () => {
  test('teacher can log in and open evidence list', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบ SEIP' })).toBeVisible({ timeout: 15_000 });

    await page.locator('#email').fill(creds.email);
    await page.locator('#password').fill(creds.password);
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();

    await expect(page.getByRole('heading', { name: 'หลักฐานของฉัน' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('link', { name: 'ส่งหลักฐานใหม่' })).toBeVisible();
  });

  test('teacher can open new evidence form (pick step)', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill(creds.email);
    await page.locator('#password').fill(creds.password);
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
    await expect(page.getByRole('heading', { name: 'หลักฐานของฉัน' })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('link', { name: 'ส่งหลักฐานใหม่' }).click();
    await expect(page).toHaveURL(/\/evidence\/new/);
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 });
  });
});
