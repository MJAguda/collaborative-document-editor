import { expect, test } from '@playwright/test';
import { login, newDocument } from './helpers.ts';

test('Alice comments, Bob sees it and replies, only the author or owner can delete, Alice resolves', async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  await login(alice, 'alice@example.com', 'Alice');
  await newDocument(alice, 'Review me');
  await alice.getByLabel('Share with (email)').fill('bob@example.com');
  await alice.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(alice.getByRole('region', { name: 'Sharing' })).toContainText('Bob (bob@example.com)');

  const aliceComments = alice.getByRole('region', { name: 'Comments' });
  await aliceComments.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(aliceComments.getByRole('alert')).toHaveText('Comment must be 1-2000 characters');
  await aliceComments.getByLabel('Add a comment').fill('Please tighten the intro <b>now</b>');
  await aliceComments.getByRole('button', { name: 'Comment', exact: true }).click();
  const first = aliceComments.getByRole('listitem').filter({ hasText: 'Please tighten the intro' });
  await expect(first).toContainText('<b>now</b>'); // shown as text, not markup
  await expect(first).toContainText('Alice');

  const bob = await (await browser.newContext()).newPage();
  await login(bob, 'bob@example.com', 'Bob');
  await bob.getByRole('link', { name: 'Review me' }).click();
  const bobComments = bob.getByRole('region', { name: 'Comments' });
  const seen = bobComments.getByRole('listitem').filter({ hasText: 'Please tighten the intro' });
  await expect(seen).toBeVisible();
  await expect(seen.getByRole('button', { name: 'Delete comment' })).toHaveCount(0);
  await bobComments.getByLabel('Add a comment').fill('Done, see my edits');
  await bobComments.getByRole('button', { name: 'Comment', exact: true }).click();
  const reply = bobComments.getByRole('listitem').filter({ hasText: 'Done, see my edits' });
  await expect(reply.getByRole('button', { name: 'Delete comment' })).toBeVisible();

  await alice.reload();
  const again = aliceComments.getByRole('listitem').filter({ hasText: 'Please tighten the intro' });
  await expect(aliceComments.getByRole('listitem').filter({ hasText: 'Done, see my edits' })).toBeVisible();
  await again.getByRole('button', { name: 'Resolve' }).click();
  await expect(again).toContainText('Resolved');
  await expect(again.getByRole('button', { name: 'Reopen' })).toBeVisible();

  // The specs share one in-memory DB: remove the document (and its comments).
  alice.on('dialog', (d) => d.accept());
  await alice.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(alice).toHaveURL(/#\/$/);
});
