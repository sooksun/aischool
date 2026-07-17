/**
 * Cleanup L2 — e2e beyond shell: upload, session refresh (SEC-002), create report, PDF, score.
 * Fixtures from global-setup (committee + ready report). MinIO required for upload; no worker needed.
 */
import { test, expect } from '@playwright/test';
import { expectLoggedInShell, loadE2eCreds, login, type E2eCreds } from './helpers';

let creds: E2eCreds;
test.beforeAll(() => { creds = loadE2eCreds(); });

test.describe('depth: evidence upload', () => {
  test('teacher completes PDF upload through submit stepper', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, creds.teacher.email, creds.teacher.password);
    await expectLoggedInShell(page);
    await page.getByRole('link', { name: 'ส่งหลักฐานใหม่' }).click();
    await expect(page).toHaveURL(/\/evidence\/new/);

    // Pick step — small PDF buffer (category lesson_plan / other_document)
    const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    await page.locator('#file-input').setInputFiles({
      name: 'e2e-plan.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBytes,
    });

    // Details — pick a PDF-capable category
    await expect(page.getByText(/หมวดหลักฐาน|แผนการ/)).toBeVisible({ timeout: 15_000 });
    const lessonPlan = page.getByRole('radio', { name: /แผนการจัดการเรียนรู้/ });
    if (await lessonPlan.isVisible().catch(() => false)) {
      await lessonPlan.click();
    } else {
      await page.getByRole('radio').first().click();
    }
    await page.locator('#title-input').fill('E2E upload plan');
    await page.getByRole('button', { name: 'ถัดไป' }).click();

    // Indicators — skip optional selection
    await expect(page.getByRole('heading', { name: /ผูกตัวชี้วัด/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'ถัดไป' }).click();

    // Review + confirm
    await expect(page.getByRole('heading', { name: /ตรวจสอบก่อนส่ง/ })).toBeVisible();
    await page.getByRole('button', { name: 'ยืนยันส่ง' }).click();

    // Done (scan may stay pending without worker)
    await expect(page.getByText(/ส่งหลักฐานสำเร็จ/)).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/รหัสหลักฐาน/)).toBeVisible();
  });
});

test.describe('depth: session refresh (SEC-002 / CCR-008)', () => {
  test('corrupted access token is rotated via refresh; shell stays usable', async ({ page }) => {
    await login(page, creds.teacher.email, creds.teacher.password);
    await expectLoggedInShell(page);

    // Ensure tokens landed in sessionStorage (AuthProvider)
    await expect.poll(async () => page.evaluate(() => sessionStorage.getItem('seip.refresh_token'))).toBeTruthy();

    await page.evaluate(() => {
      sessionStorage.setItem('seip.access_token', 'eyJhbGciOiJIUzI1NiJ9.e30.invalid');
    });

    // Next authenticated navigation triggers API → 401 → refresh → retry
    await page.getByRole('link', { name: 'รายงาน PA' }).click();
    await expect(page).toHaveURL(/\/reports/);
    await expect(page.getByRole('heading', { name: /รายงาน/ })).toBeVisible({ timeout: 20_000 });

    // Access token should have been replaced (not the garbage we wrote)
    const access = await page.evaluate(() => sessionStorage.getItem('seip.access_token'));
    expect(access).toBeTruthy();
    expect(access).not.toBe('eyJhbGciOiJIUzI1NiJ9.e30.invalid');
  });
});

test.describe('depth: create report + PDF', () => {
  test('director creates a report via UI', async ({ page }) => {
    test.skip(!creds.cycleId || !creds.teacherPersonnelId, 'global-setup did not seed cycle/personnel');
    await login(page, creds.director.email, creds.director.password);
    await expect(page.getByRole('link', { name: 'รายงาน PA' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('link', { name: 'รายงาน PA' }).click();
    await expect(page.getByRole('heading', { name: /รายงาน/ })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: '+ สร้างรายงาน' }).click();
    await expect(page.getByRole('heading', { name: /สร้างรายงานใหม่/ })).toBeVisible();

    // Cycle select — prefer E2E Smoke Cycle
    const cycleSelect = page.locator('select').first();
    await cycleSelect.selectOption({ label: /E2E Smoke Cycle/ });
    await page.locator('input[placeholder="personnel profile uuid"]').fill(creds.teacherPersonnelId!);
    await page.getByRole('button', { name: 'สร้างและจัดทำรายงาน' }).click();

    // Form closes; list reloads (new draft may appear)
    await expect(page.getByRole('button', { name: '+ สร้างรายงาน' })).toBeVisible({ timeout: 15_000 });
  });

  test('director downloads draft/review PDF for ready report', async ({ page }) => {
    test.skip(!creds.readyReportId, 'global-setup did not seed ready report');
    await login(page, creds.director.email, creds.director.password);
    await page.goto(`/reports/${creds.readyReportId}`);
    await expect(page.getByRole('button', { name: /ดาวน์โหลด PDF/ })).toBeEnabled({ timeout: 20_000 });

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: /ดาวน์โหลด PDF/ }).click(),
    ]);
    const name = download.suggestedFilename();
    expect(name).toMatch(/\.pdf$/i);
  });
});

test.describe('depth: committee scoring', () => {
  test('director chair opens assignment and submits scores', async ({ page }) => {
    test.skip(!creds.assignmentId || !creds.cycleId || !creds.roundId, 'global-setup did not seed assignment');
    test.setTimeout(120_000);

    await login(page, creds.director.email, creds.director.password);
    await page.getByRole('link', { name: 'งานกรรมการ' }).click();
    await expect(page).toHaveURL(/\/evaluator/);

    // Cycle → round → assignment (titles from fixtures)
    await page.getByRole('link', { name: /E2E Smoke Cycle/ }).click();
    await expect(page).toHaveURL(new RegExp(`/evaluator/cycles/${creds.cycleId}`));
    await page.getByRole('link', { name: /รอบที่ 1/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/evaluator/rounds/${creds.roundId}`));

    // Prefer direct navigation if list is slow/empty after reload
    await page.goto(`/evaluator/assignments/${creds.assignmentId}`);
    await expect(page).toHaveURL(new RegExp(`/evaluator/assignments/${creds.assignmentId}`));
    await expect(page.getByRole('heading', { name: /ให้คะแนน/ })).toBeVisible({ timeout: 20_000 });

    // Workload gate (chair) — then every indicator radiogroup → level ~3
    await page.getByRole('radio', { name: 'ผ่านเกณฑ์ภาระงาน' }).check();

    const groups = page.locator('[role="radiogroup"][aria-label^="ระดับคะแนน"]');
    const n = await groups.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const radios = groups.nth(i).getByRole('radio');
      const rc = await radios.count();
      if (rc > 0) {
        await radios.nth(Math.min(2, rc - 1)).check();
      }
    }

    await page.getByRole('button', { name: 'บันทึกคะแนนของฉัน' }).click();
    await expect(page.getByText(/บันทึกแล้ว/)).toBeVisible({ timeout: 45_000 });
  });
});
