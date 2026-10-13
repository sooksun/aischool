// CCR-018 / ADR-0014 §4: signing in to the web through Keycloak (the BFF cookie
// session). Runs when the stack serves web sign-in — KEYCLOAK_ISSUER and
// WEB_PUBLIC_ORIGIN set for both the API and Vite, as in CI.
import { test, expect } from '@playwright/test';
import { expectLoggedInShell, loadE2eCreds, type E2eCreds } from './helpers';

let creds: E2eCreds;
test.beforeAll(() => { creds = loadE2eCreds(); });

test('teacher signs in with SEIP ID, keeps the session across a reload, and signs out', async ({ page }) => {
  test.skip(!creds.sso, 'web sign-in is not configured on this stack');
  const sso = creds.sso!;

  await page.goto('/login');
  await page.getByRole('link', { name: 'เข้าสู่ระบบด้วย SEIP ID' }).click();

  // Keycloak's own login page.
  await page.locator('#username').fill(sso.email);
  await page.locator('#password').fill(sso.password);
  await page.locator('#kc-login').click();

  await expectLoggedInShell(page);
  // No token is ever handed to the page: the session is the httpOnly cookie.
  expect(await page.evaluate(() => sessionStorage.length + localStorage.length)).toBe(0);
  expect(await page.evaluate(() => document.cookie)).not.toMatch(/__Host-seip=/);

  await page.reload();
  await expectLoggedInShell(page);

  // Sign-out is a POST that needs X-CSRF-Token; if the header were missing the
  // API would refuse it and the reload below would still be signed in.
  await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบ SEIP' })).toBeVisible({ timeout: 15_000 });
});
