import { expect, test } from '@playwright/test';
import { login, newDocument } from './helpers.ts';

test('anchored comment: highlight persists, Bob sees it with its quote, resolving removes it', async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  await login(alice, 'alice@example.com', 'Alice');
  await newDocument(alice, 'Anchor me');
  const editor = alice.locator('.ProseMirror');
  await editor.click();
  await alice.keyboard.type('The quick brown fox');
  await expect(alice.getByRole('status')).toHaveText('Saved');
  await alice.getByLabel('Share with (email)').fill('bob@example.com');
  await alice.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(alice.getByRole('region', { name: 'Sharing' })).toContainText('Bob (bob@example.com)');

  await editor.click();
  await alice.keyboard.press('Control+End');
  await alice.keyboard.press('Control+Shift+ArrowLeft'); // selects "fox"
  const comments = alice.getByRole('region', { name: 'Comments' });
  await comments.getByLabel('Add a comment').fill('Too cliche');
  await comments.getByRole('button', { name: 'Comment', exact: true }).click();
  const mark = editor.locator('span[data-comment-id]');
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveText('fox');
  await expect(alice.getByRole('status')).toHaveText('Saved');
  await expect(comments.getByRole('listitem').filter({ hasText: 'Too cliche' })).toContainText('fox');

  await alice.reload();
  await expect(editor.locator('span[data-comment-id]')).toHaveText('fox');

  const bob = await (await browser.newContext()).newPage();
  await login(bob, 'bob@example.com', 'Bob');
  await bob.getByRole('link', { name: 'Anchor me' }).click();
  await expect(bob.locator('.ProseMirror span[data-comment-id]')).toHaveText('fox');
  await expect(bob.getByRole('region', { name: 'Comments' }).getByRole('listitem').filter({ hasText: 'Too cliche' })).toContainText('fox');

  const item = comments.getByRole('listitem').filter({ hasText: 'Too cliche' });
  await item.getByRole('button', { name: 'Resolve' }).click();
  await expect(item).toContainText('Resolved');
  await expect(alice.locator('.ProseMirror span[data-comment-id]')).toHaveCount(0);
  await expect(alice.getByRole('status')).toHaveText('Saved');
  await alice.reload();
  await expect(alice.locator('.ProseMirror span[data-comment-id]')).toHaveCount(0);
  await expect(alice.locator('.ProseMirror')).toContainText('The quick brown fox');

  alice.on('dialog', (d) => d.accept());
  await alice.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(alice).toHaveURL(/#\/$/);
});
