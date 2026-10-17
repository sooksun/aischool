// P3 v0: a teacher writes a note; the system suggests an indicator (heuristic
// floor, labelled as such); the teacher accepts it and it becomes a mapping
// waiting for the director. Needs the worker running next to the API.
import { test, expect } from '@playwright/test';
import { expectLoggedInShell, loadE2eCreds, login, type E2eCreds } from './helpers';

let creds: E2eCreds;
test.beforeAll(() => { creds = loadE2eCreds(); });

test('teacher accepts a suggested indicator for a note', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, creds.teacher.email, creds.teacher.password);
  await expectLoggedInShell(page);
  await page.getByRole('link', { name: 'ลิงก์/บันทึก' }).click();
  await page.getByRole('radio', { name: 'บันทึกข้อความ' }).click();
  await page.getByLabel('ชื่อหลักฐาน').fill(`บันทึกประชุมผู้ปกครอง ${Date.now()}`);
  await page.getByLabel('บันทึก').fill('ประชุมผู้ปกครองและภาคีเครือข่าย สร้างความร่วมมือส่งเสริมการอ่านที่บ้าน');
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click();

  const box = page.getByRole('region', { name: 'ตัวชี้วัดที่ระบบแนะนำ' });
  const card = box.getByRole('listitem').filter({ hasText: 'T-2.4' });
  await expect(card).toBeVisible({ timeout: 45_000 });
  await expect(box.getByText(/คำแนะนำชุดนี้มาจากระบบสำรองแบบจับคำ/)).toBeVisible();

  await card.getByRole('button', { name: 'ใช่ ผูกตัวชี้วัดนี้' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText('รอผู้บริหารหรือกรรมการตรวจรับรอง')).toBeVisible();
});
