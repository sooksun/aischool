// Expanded browser smoke (SEIP-QA-004+) — login, evidence, director cycles, reports nav.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const creds = JSON.parse(readFileSync(resolve(__dirname, '.auth/e2e-user.json'), 'utf8')) as {
  teacher: { email: string; password: string };
  director: { email: string; password: string };
};

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบ SEIP' })).toBeVisible({ timeout: 15_000 });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
}

test.describe('smoke: teacher evidence', () => {
  test('teacher can log in and open evidence list', async ({ page }) => {
    await login(page, creds.teacher.email, creds.teacher.password);
    await expect(page.getByRole('heading', { name: 'หลักฐานของฉัน' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('link', { name: 'ส่งหลักฐานใหม่' })).toBeVisible();
  });

  test('teacher can open new evidence form (pick step)', async ({ page }) => {
    await login(page, creds.teacher.email, creds.teacher.password);
    await expect(page.getByRole('heading', { name: 'หลักฐานของฉัน' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('link', { name: 'ส่งหลักฐานใหม่' }).click();
    await expect(page).toHaveURL(/\/evidence\/new/);
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 });
  });

  test('teacher can open reports list (own scope)', async ({ page }) => {
    await login(page, creds.teacher.email, creds.teacher.password);
    await expect(page.getByRole('heading', { name: 'หลักฐานของฉัน' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('link', { name: 'รายงาน PA' }).click();
    await expect(page).toHaveURL(/\/reports/);
    await expect(page.getByRole('heading', { name: /รายงาน/ })).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('smoke: director shell', () => {
  test('director reaches cycle management and reports', async ({ page }) => {
    await login(page, creds.director.email, creds.director.password);
    // Director lands on evidence list too (shared shell)
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
