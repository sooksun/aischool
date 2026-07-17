import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type E2eCreds = {
  teacher: { email: string; password: string };
  director: { email: string; password: string };
  schoolId: string;
  teacherPersonnelId: string | null;
  cycleId: string | null;
  roundId: string | null;
  assignmentId: string | null;
  readyReportId: string | null;
};

export function loadE2eCreds(): E2eCreds {
  return JSON.parse(readFileSync(resolve(__dirname, '.auth/e2e-user.json'), 'utf8')) as E2eCreds;
}

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบ SEIP' })).toBeVisible({ timeout: 15_000 });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
}

export async function expectLoggedInShell(page: Page) {
  await expect(page.getByRole('heading', { name: 'หลักฐานของฉัน' })).toBeVisible({ timeout: 20_000 });
}
