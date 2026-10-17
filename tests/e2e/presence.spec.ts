import { expect, test } from '@playwright/test';
import { login, newDocument } from './helpers.ts';

test('viewers see each other and a "saved changes" notice appears before any 409', async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  await login(alice, 'alice@example.com', 'Alice');
  await newDocument(alice, 'Presence doc');
  await alice.getByLabel('Share with (email)').fill('bob@example.com');
  await alice.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(alice.getByRole('region', { name: 'Sharing' })).toContainText('Bob (bob@example.com)');
  // Poll every 0.5 s instead of 10 s; the hash is the document route.
  const docHash = new URL(alice.url()).hash;
  await alice.goto(`/?presenceMs=500${docHash}`);

  const bob = await (await browser.newContext()).newPage();
  await login(bob, 'bob@example.com', 'Bob');
  await bob.goto(`/?presenceMs=500${docHash}`);

  await expect(alice.getByText('Bob is viewing')).toBeVisible();
  await expect(bob.getByText('Alice is viewing')).toBeVisible();

  let conflicts = 0;
  alice.on('response', (r) => r.status() === 409 && conflicts++);
  await bob.locator('.ProseMirror').click();
  await bob.keyboard.type('Hello from Bob');
  await expect(bob.getByRole('status')).toHaveText('Saved');

  await expect(alice.getByText('Bob saved changes.')).toBeVisible();
  await expect(alice.getByRole('button', { name: 'Reload' })).toBeVisible();
  expect(conflicts).toBe(0);
  await alice.getByRole('button', { name: 'Reload' }).click();
  await expect(alice.locator('.ProseMirror')).toHaveText('Hello from Bob');

  await bob.evaluate(() => (location.hash = '#/')); // leaving the editor sends the leave request
  await expect(alice.getByText('Bob is viewing')).toHaveCount(0);

  // Clean up: the e2e database is shared, and other specs expect Bob to have no shared documents yet.
  alice.once('dialog', (d) => d.accept());
  await alice.getByRole('button', { name: 'Delete' }).click();
  await expect(alice.getByRole('heading', { name: 'My documents' })).toBeVisible();
});
