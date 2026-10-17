import { expect, test } from '@playwright/test';
import { login, newDocument } from './helpers.ts';

test('owner shares with Bob, Bob edits, the owner sees a conflict, then revokes', async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  await login(alice, 'alice@example.com', 'Alice');
  await newDocument(alice, 'Team plan');
  await alice.locator('.ProseMirror').click();
  await alice.keyboard.type('Draft from Alice');
  await expect(alice.getByRole('status')).toHaveText('Saved');

  const shareWith = async (email: string) => {
    await alice.getByLabel('Share with (email)').fill(email);
    await alice.getByRole('button', { name: 'Share', exact: true }).click();
  };
  await shareWith('alice@example.com');
  await expect(alice.getByRole('alert')).toHaveText('You already own this document');
  await shareWith('nobody@example.com');
  await expect(alice.getByRole('alert')).toHaveText('No user with that email');
  await shareWith('bob@example.com');
  await expect(alice.getByRole('region', { name: 'Sharing' })).toContainText('Bob (bob@example.com)');

  const bob = await (await browser.newContext()).newPage();
  await login(bob, 'bob@example.com', 'Bob');
  const shared = bob.getByRole('region', { name: 'Shared with me' });
  await expect(shared.getByRole('listitem').filter({ hasText: 'Team plan' })).toContainText('Shared by Alice');
  await expect(bob.getByRole('region', { name: 'My documents' })).not.toContainText('Team plan');
  await shared.getByRole('link', { name: 'Team plan' }).click();
  await expect(bob.getByText('Shared by Alice')).toBeVisible();
  await expect(bob.getByRole('heading', { name: 'Team plan' })).toBeVisible();
  await expect(bob.getByLabel('Title')).toHaveCount(0);
  await expect(bob.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(bob.getByRole('region', { name: 'Sharing' })).toHaveCount(0);
  await bob.locator('.ProseMirror').click();
  await bob.keyboard.press('ControlOrMeta+End');
  await bob.keyboard.type(' and Bob');
  await expect(bob.getByRole('status')).toHaveText('Saved');

  await alice.locator('.ProseMirror').click();
  await alice.keyboard.press('ControlOrMeta+End');
  await alice.keyboard.type('!');
  await expect(alice.getByText('This document was changed by Bob. Reload to get the latest version.')).toBeVisible();
  // Autosave must stay stopped after the conflict (wait longer than the 1 s debounce).
  let patchesAfterConflict = 0;
  alice.on('request', (r) => r.method() === 'PATCH' && patchesAfterConflict++);
  await alice.waitForTimeout(2500);
  expect(patchesAfterConflict).toBe(0);
  await alice.reload();
  await expect(alice.locator('.ProseMirror')).toHaveText('Draft from Alice and Bob');

  await alice.getByRole('button', { name: 'Remove Bob' }).click();
  await expect(alice.getByText('Not shared with anyone yet.')).toBeVisible();
  await bob.goto('/');
  await expect(bob.getByRole('region', { name: 'Shared with me' })).toBeVisible();
  await expect(bob.getByRole('link', { name: 'Team plan' })).toHaveCount(0);
});
