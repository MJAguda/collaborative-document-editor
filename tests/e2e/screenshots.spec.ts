import { expect, test } from '@playwright/test';
import { statSync } from 'node:fs';
import { login, newDocument } from './helpers.ts';

// Regenerates docs/screenshots/*.png. Run with `npm run screenshots` (skipped in the default e2e run).
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 (npm run screenshots)');
test.use({ viewport: { width: 1280, height: 800 } });

const dir = 'docs/screenshots';
const shot = async (page: import('@playwright/test').Page, name: string) => {
  const path = `${dir}/${name}.png`;
  await page.screenshot({ path });
  expect(statSync(path).size).toBeGreaterThan(0);
};

test('capture screenshots', async ({ browser }) => {
  const ctx = (await browser.newContext({ viewport: { width: 1280, height: 800 } }));
  const anon = await ctx.newPage();
  await anon.goto('/');
  await expect(anon.getByRole('button', { name: 'Log in' })).toBeVisible();
  await shot(anon, '01-login');

  const alice = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await login(alice, 'alice@example.com', 'Alice');
  await expect(alice.getByText('Supported: .txt, .md, .docx (max 2 MB)')).toBeVisible();
  await shot(alice, '04-import');

  await newDocument(alice, 'Quarterly plan');
  const body = alice.locator('.ProseMirror');
  await body.click();
  await alice.getByRole('button', { name: 'Heading 2' }).click();
  await alice.keyboard.type('Agenda');
  await alice.keyboard.press('Enter');
  await alice.keyboard.press('ControlOrMeta+b');
  await alice.keyboard.type('bold');
  await alice.keyboard.press('ControlOrMeta+b');
  await alice.keyboard.type(' ');
  await alice.keyboard.press('ControlOrMeta+i');
  await alice.keyboard.type('italic');
  await alice.keyboard.press('ControlOrMeta+i');
  await alice.keyboard.type(' ');
  await alice.keyboard.press('ControlOrMeta+u');
  await alice.keyboard.type('underlined');
  await alice.keyboard.press('ControlOrMeta+u');
  await alice.keyboard.press('Enter');
  await alice.getByRole('button', { name: 'Bulleted list' }).click();
  await alice.keyboard.type('Ship the editor');
  await alice.keyboard.press('Enter');
  await alice.keyboard.type('Write the docs');
  await alice.keyboard.press('Enter');
  await alice.keyboard.press('Enter');
  await alice.getByRole('button', { name: 'Numbered list' }).click();
  await alice.keyboard.type('Review');
  await alice.keyboard.press('Enter');
  await alice.keyboard.type('Deploy');
  await expect(alice.getByRole('status')).toHaveText('Saved');
  await shot(alice, '03-editor-formatting');

  await alice.getByLabel('Share with (email)').fill('bob@example.com');
  await alice.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(alice.getByRole('region', { name: 'Sharing' })).toContainText('Bob (bob@example.com)');
  await shot(alice, '05-share-panel');

  const bob = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await login(bob, 'bob@example.com', 'Bob');
  await newDocument(bob, "Bob's notes");
  await bob.getByRole('link', { name: 'Documents' }).click();
  const shared = bob.getByRole('region', { name: 'Shared with me' });
  await expect(shared.getByRole('link', { name: 'Quarterly plan' })).toBeVisible();
  await expect(bob.getByRole('region', { name: 'My documents' }).getByRole('link', { name: "Bob's notes" })).toBeVisible();
  await shot(bob, '02-doc-list');

  // Conflict: Bob saves, then Alice (stale version) types. Default 10 s presence poll, so the 409 banner comes first.
  await shared.getByRole('link', { name: 'Quarterly plan' }).click();
  await bob.locator('.ProseMirror').click();
  await bob.keyboard.press('ControlOrMeta+End');
  await bob.keyboard.type(' Bob was here');
  await expect(bob.getByRole('status')).toHaveText('Saved');
  await body.click();
  await alice.keyboard.press('ControlOrMeta+End');
  await alice.keyboard.type('!');
  await expect(alice.getByText('This document was changed by Bob. Reload to get the latest version.')).toBeVisible();
  await shot(alice, '06-conflict-banner');

  // Presence: both reopen with a 0.5 s poll; Bob saves again and Alice sees the notice.
  const docHash = new URL(alice.url()).hash;
  await alice.goto(`/?presenceMs=500${docHash}`);
  await bob.goto(`/?presenceMs=500${docHash}`);
  await expect(alice.getByText('Bob is viewing')).toBeVisible();
  await expect(bob.getByText('Alice is viewing')).toBeVisible();
  await bob.locator('.ProseMirror').click();
  await bob.keyboard.press('ControlOrMeta+End');
  await bob.keyboard.type(' Second edit');
  await expect(bob.getByRole('status')).toHaveText('Saved');
  await expect(alice.getByText('Bob saved changes.')).toBeVisible();
  await expect(alice.getByText('Bob is viewing')).toBeVisible();
  await shot(alice, '07-presence');
});
