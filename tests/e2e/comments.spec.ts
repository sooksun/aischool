// CCR-028 (FR-064): the evaluatee finds their assessment, reads the committee's
// request on an indicator, and replies. The director sees the reply under it.
import { test, expect } from '@playwright/test';
import { expectLoggedInShell, loadE2eCreds, login, type E2eCreds } from './helpers';

let creds: E2eCreds;
test.beforeAll(() => { creds = loadE2eCreds(); });

test('teacher replies to the committee\'s request; the director reads the reply', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await login(page, creds.teacher.email, creds.teacher.password);
  await expectLoggedInShell(page);
  await page.getByRole('link', { name: 'การประเมินของฉัน' }).click();
  await page.getByRole('list', { name: 'การประเมินของฉัน' }).getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'ความเห็นจากกรรมการ' })).toBeVisible();

  const thread = page.getByRole('region', { name: /T-1\.1/ });
  await expect(thread.getByText('ขอดูแผนการจัดการเรียนรู้ฉบับเต็มของหน่วยนี้ครับ')).toBeVisible();
  const reply = `แนบไว้ในหลักฐานแล้วครับ ${Date.now()}`;
  await thread.getByRole('button', { name: 'ตอบ' }).first().click();
  await thread.getByLabel('ข้อความตอบ').fill(reply);
  await thread.getByRole('button', { name: 'ส่ง', exact: true }).click();
  await expect(thread.getByText(reply)).toBeVisible();
  await expect(thread.getByLabel('ความเห็น', { exact: true })).toHaveCount(0); // the evaluatee cannot open a thread

  // A separate browser context: the director signs in on their own.
  const ctx = await browser.newContext();
  const director = await ctx.newPage();
  await login(director, creds.director.email, creds.director.password);
  await expectLoggedInShell(director);
  await director.goto(`/assignments/${creds.assignmentId}/comments`);
  await expect(director.getByText(reply)).toBeVisible();
  await ctx.close();
});
