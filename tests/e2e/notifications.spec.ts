// P4 (FR-102): when the system has suggestions for an item, the owner gets an
// in-app notification that opens the item.
import { test, expect } from '@playwright/test';
import { expectLoggedInShell, loadE2eCreds, login, type E2eCreds } from './helpers';

let creds: E2eCreds;
test.beforeAll(() => { creds = loadE2eCreds(); });

test('a note with suggestions notifies its owner; the notification opens the item', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, creds.teacher.email, creds.teacher.password);
  await expectLoggedInShell(page);
  const title = `บันทึกแจ้งเตือน ${Date.now()}`;
  await page.getByRole('link', { name: 'ลิงก์/บันทึก' }).click();
  await page.getByRole('radio', { name: 'บันทึกข้อความ' }).click();
  await page.getByLabel('ชื่อหลักฐาน').fill(title);
  await page.getByLabel('บันทึก').fill('ออกแบบการจัดการเรียนรู้ร่วมกับผู้ปกครองและภาคีเครือข่าย');
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const itemUrl = page.url();

  // The worker analyses, then dispatches the event into the inbox.
  await expect(async () => {
    await page.goto('/notifications');
    await expect(page.getByRole('list', { name: 'รายการแจ้งเตือน' }).getByText('มีตัวชี้วัดที่ระบบแนะนำสำหรับหลักฐานของคุณ').first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 45_000 });

  await page.getByRole('list', { name: 'รายการแจ้งเตือน' }).getByRole('button').first().click();
  await expect(page).toHaveURL(itemUrl);
});
