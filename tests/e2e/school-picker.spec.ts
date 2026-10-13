// FR-019: a person at two schools chooses which one they are working for; the
// choice is remembered for their next visit on this browser.
import { test, expect } from '@playwright/test';
import { expectLoggedInShell, loadE2eCreds, login, type E2eCreds } from './helpers';

let creds: E2eCreds;
test.beforeAll(() => { creds = loadE2eCreds(); });

test('a teacher at two schools picks one, and the pick is remembered', async ({ page }) => {
  const { email, password, schools } = creds.multiSchool;
  await login(page, email, password);
  await expectLoggedInShell(page);

  const picker = page.getByLabel('คุณอยู่หลายโรงเรียน กรุณาเลือกโรงเรียนที่กำลังทำงานให้');
  await expect(picker).toBeVisible();
  await picker.selectOption({ label: schools[1] });

  // Chosen: the prompt becomes a plain selector showing the school.
  const chosen = page.getByLabel('โรงเรียน', { exact: true });
  await expect(chosen).toHaveValue(/.+/);
  await expect(chosen.locator('option:checked')).toHaveText(schools[1]);

  // Next visit: same school, no prompt.
  await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await login(page, email, password);
  await expectLoggedInShell(page);
  await expect(page.getByLabel('โรงเรียน', { exact: true }).locator('option:checked')).toHaveText(schools[1]);
});
