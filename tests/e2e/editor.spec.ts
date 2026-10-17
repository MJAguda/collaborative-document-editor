import { expect, test } from '@playwright/test';
import { login, newDocument } from './helpers.ts';

test('create, rename, format, autosave and reopen a document', async ({ page }) => {
  await login(page, 'alice@example.com', 'Alice');
  await newDocument(page, 'Meeting notes');
  await expect(page.getByText('Owned by you')).toBeVisible();

  const body = page.locator('.ProseMirror');
  const bold = page.getByRole('button', { name: 'Bold' });
  await body.click();
  await page.getByRole('button', { name: 'Heading 2' }).click();
  await page.keyboard.type('Agenda');
  await page.keyboard.press('Enter');
  await bold.click();
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.type('bold');
  await bold.click();
  await page.keyboard.type(' ');
  await page.getByRole('button', { name: 'Italic' }).click();
  await page.keyboard.type('italic');
  await page.getByRole('button', { name: 'Italic' }).click();
  await page.keyboard.type(' ');
  await page.keyboard.press('ControlOrMeta+u');
  await page.keyboard.type('underlined');
  await page.keyboard.press('ControlOrMeta+u');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Bulleted list' }).click();
  await page.keyboard.type('one');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Numbered list' }).click();
  await page.keyboard.type('first');
  await expect(page.getByRole('status')).toHaveText('Saved');

  await page.reload();
  await expect(page.getByLabel('Title')).toHaveValue('Meeting notes');
  await expect(body.locator('h2')).toHaveText('Agenda');
  await expect(body.locator('strong')).toHaveText('bold');
  await expect(body.locator('em')).toHaveText('italic');
  await expect(body.locator('u')).toHaveText('underlined');
  await expect(body.locator('ul > li')).toHaveText('one');
  await expect(body.locator('ol > li')).toHaveText('first');

  await page.getByRole('link', { name: 'Documents' }).click();
  await expect(page.getByRole('region', { name: 'My documents' }).getByRole('link', { name: 'Meeting notes' })).toBeVisible();
});

test('an empty title is rejected with a visible message', async ({ page }) => {
  await login(page, 'alice@example.com', 'Alice');
  await newDocument(page, '   ');
  await expect(page.getByRole('alert')).toHaveText('Title must be 1-200 characters');
});

test('the owner deletes a document', async ({ page }) => {
  await login(page, 'alice@example.com', 'Alice');
  await newDocument(page, 'To delete');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('region', { name: 'My documents' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'To delete' })).toHaveCount(0);
});
