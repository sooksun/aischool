/**
 * CCR-014 / SEIP-BLOCK-001 — onboarding through the browser.
 *
 * This is the regression guard for the specific failure that made the 2026-07-19
 * audit necessary: a fully green test suite on a system nobody could log into.
 * The suite was green because every fixture inserted its identity rows straight
 * through Prisma. This spec creates a person the way a school actually would —
 * an admin invites them in the UI, they set their own password in the UI, they
 * log in — and asserts they arrive at their own account.
 *
 * The only identity it does not create is the admin itself, because bootstrapping
 * the first admin is an operator CLI by design (CCR-014 decision 1).
 */
import { test, expect } from '@playwright/test';
import { loadE2eCreds, login, type E2eCreds } from './helpers';

let creds: E2eCreds;
test.beforeAll(() => { creds = loadE2eCreds(); });

// Unique per run: re-inviting a current member is a 409 by design (RES-003), so
// a fixed address would pass once and fail on every re-run.
function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@seip.local`;
}

test.describe('onboarding: invite → accept → login', () => {
  test('an admin can onboard a teacher who then logs in, entirely through the UI', async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(!creds.admin, 'global-setup did not seed the school_admin fixture');

    const teacherEmail = uniqueEmail('e2e-onboard');
    const teacherPassword = 'onboarded-teacher-pw-1234';

    // ── admin invites ──
    await login(page, creds.admin.email, creds.admin.password);
    await page.getByRole('link', { name: 'บุคลากร' }).click();
    await expect(page.getByRole('heading', { name: 'บุคลากรและสิทธิ์การใช้งาน' })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: '+ เชิญบุคลากร' }).click();
    await page.locator('#invite-email').fill(teacherEmail);
    await page.locator('#invite-name').fill('ครูอีทูอี');
    await page.locator('#invite-role').selectOption('teacher');
    await page.locator('#invite-fullname').fill('ครูอีทูอี ทดสอบ');

    // Rank options come from the seeded framework (ADR-0003), so pick whatever
    // the taxonomy actually offers rather than hard-coding a code here.
    const rank = page.locator('#invite-rank');
    await expect(rank).toBeVisible();
    const rankValue = await rank.locator('option').nth(1).getAttribute('value');
    await rank.selectOption(rankValue!);

    await page.getByRole('button', { name: 'เชิญเข้าใช้ระบบ' }).click();

    // The token is shown exactly once and never retrievable again — read it from
    // the panel, which is the only place it will ever appear.
    const tokenBox = page.locator('main code');
    await expect(tokenBox).toBeVisible({ timeout: 20_000 });
    const inviteToken = (await tokenBox.textContent())!.trim();
    expect(inviteToken.length).toBeGreaterThan(20);

    // The new member is listed, and visibly cannot log in yet. Scoped to the
    // list item: the email also appears in the success panel above, and an
    // unscoped getByText would be strict-mode ambiguous.
    const memberRow = page.locator('main li').filter({ hasText: teacherEmail });
    await expect(memberRow).toHaveCount(1);
    await expect(memberRow.getByText('รอตั้งรหัสผ่าน')).toBeVisible();

    // ── invitee accepts ──
    // Clear the admin's session first: the invitee is a different person on a
    // different device, and accept-invite must work with no bearer token at all.
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(`/accept-invite?token=${encodeURIComponent(inviteToken)}`);

    await expect(page.getByRole('heading', { name: 'ตั้งรหัสผ่านครั้งแรก' })).toBeVisible({ timeout: 20_000 });
    // The token arrives prefilled from the query string.
    await expect(page.locator('#invite-token')).toHaveValue(inviteToken);
    await page.locator('#new-password').fill(teacherPassword);
    await page.locator('#confirm-password').fill(teacherPassword);
    await page.getByRole('button', { name: 'ตั้งรหัสผ่าน' }).click();

    await expect(page.getByRole('heading', { name: 'ตั้งรหัสผ่านเรียบร้อย' })).toBeVisible({ timeout: 20_000 });

    // ── the assertion that matters ──
    await login(page, teacherEmail, teacherPassword);
    await expect(page.getByRole('heading', { name: 'หลักฐานของฉัน' })).toBeVisible({ timeout: 20_000 });
    // Their own display name, not the admin's — proves this is a distinct
    // account and not a leftover session.
    await expect(page.getByText('ครูอีทูอี')).toBeVisible();
    // A teacher must not see the admin-only nav entry.
    await expect(page.getByRole('link', { name: 'บุคลากร' })).toHaveCount(0);
  });

  test('a used invite token cannot be redeemed a second time', async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(!creds.admin, 'global-setup did not seed the school_admin fixture');

    const email = uniqueEmail('e2e-replay');

    await login(page, creds.admin.email, creds.admin.password);
    await page.getByRole('link', { name: 'บุคลากร' }).click();
    await page.getByRole('button', { name: '+ เชิญบุคลากร' }).click();
    await page.locator('#invite-email').fill(email);
    await page.locator('#invite-name').fill('ผู้ถูกเชิญซ้ำ');
    // evaluator needs no personnel block — the form hides those fields entirely.
    await page.locator('#invite-role').selectOption('evaluator');
    await page.getByRole('button', { name: 'เชิญเข้าใช้ระบบ' }).click();

    const tokenBox = page.locator('main code');
    await expect(tokenBox).toBeVisible({ timeout: 20_000 });
    const inviteToken = (await tokenBox.textContent())!.trim();

    await page.evaluate(() => sessionStorage.clear());

    await page.goto(`/accept-invite?token=${encodeURIComponent(inviteToken)}`);
    await page.locator('#new-password').fill('first-acceptance-pw-1234');
    await page.locator('#confirm-password').fill('first-acceptance-pw-1234');
    await page.getByRole('button', { name: 'ตั้งรหัสผ่าน' }).click();
    await expect(page.getByRole('heading', { name: 'ตั้งรหัสผ่านเรียบร้อย' })).toBeVisible({ timeout: 20_000 });

    // Replay with a password an attacker chose.
    await page.goto(`/accept-invite?token=${encodeURIComponent(inviteToken)}`);
    await page.locator('#new-password').fill('attacker-chosen-pw-1234');
    await page.locator('#confirm-password').fill('attacker-chosen-pw-1234');
    await page.getByRole('button', { name: 'ตั้งรหัสผ่าน' }).click();

    await expect(page.getByRole('alert')).toContainText('รหัสเชิญนี้ใช้ไม่ได้', { timeout: 20_000 });

    // The first password still works — the failed replay changed nothing.
    await login(page, email, 'first-acceptance-pw-1234');
    await expect(page.getByRole('heading', { name: 'หลักฐานของฉัน' })).toBeVisible({ timeout: 20_000 });
  });
});
