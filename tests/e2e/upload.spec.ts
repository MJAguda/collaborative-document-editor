import { expect, test } from '@playwright/test';
import { login } from './helpers.ts';

test('importing a Markdown file creates an editable document', async ({ page }) => {
  await login(page, 'alice@example.com', 'Alice');
  await expect(page.getByText('Supported: .txt, .md, .docx (max 2 MB)')).toBeVisible();
  await page.getByLabel('Import a file').setInputFiles('tests/fixtures/sample.md');
  await expect(page).toHaveURL(/#\/doc\/\d+$/);
  await expect(page.getByLabel('Title')).toHaveValue('sample');
  const body = page.locator('.ProseMirror');
  await expect(body.locator('h1')).toHaveText('Imported heading');
  await expect(body.locator('strong')).toHaveText('bold');
  await expect(body.locator('ul > li')).toHaveText(['First', 'Second']);
  await body.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' edited');
  await expect(page.getByRole('status')).toHaveText('Saved');
});

test('importing an unsupported file shows an error and creates nothing', async ({ page }) => {
  await login(page, 'alice@example.com', 'Alice');
  const mine = page.getByRole('region', { name: 'My documents' });
  await expect(mine).toBeVisible();
  const before = await mine.getByRole('listitem').count();
  await page.getByLabel('Import a file').setInputFiles({ name: 'report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await expect(page.getByRole('alert')).toHaveText('Unsupported file type. Supported: .txt, .md, .docx');
  await page.reload();
  await expect(mine).toBeVisible();
  expect(await mine.getByRole('listitem').count()).toBe(before);
});
