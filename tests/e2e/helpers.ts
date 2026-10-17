import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function login(page: Page, email: string, name: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('demo1234');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText(`Signed in as ${name}`)).toBeVisible();
}

export async function newDocument(page: Page, title: string) {
  await page.getByRole('button', { name: 'New document' }).click();
  await expect(page).toHaveURL(/#\/doc\/\d+$/);
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Title').press('Enter');
}
