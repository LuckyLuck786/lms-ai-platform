import { expect, test } from '@playwright/test';
import fs from 'fs';
import { SESSIONS_FILE } from '../global-setup';

/** Account settings and email verification, through the real UI and API. */

type Session = { access_token: string; refresh_token: string; user: { full_name: string } };

test.beforeEach(async ({ page }) => {
  const { sessions } = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')) as {
    sessions: Record<string, Session>;
  };
  const s = sessions.student;
  await page.addInitScript((sess) => {
    localStorage.setItem('lms.access_token', sess.access_token);
    localStorage.setItem('lms.refresh_token', sess.refresh_token);
    localStorage.setItem('lms.user', JSON.stringify(sess.user));
  }, s);
});

test('a learner opens account settings from the header and edits their profile', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Ananya/ }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: 'Account settings' })).toBeVisible();
  await expect(page.getByText('student@vertexon.demo')).toBeVisible();
  await expect(page.getByText('Verified', { exact: true })).toBeVisible();

  const name = page.getByLabel('Full name');
  const original = await name.inputValue();
  await name.fill('Ananya S.');
  await page.getByLabel('Phone number').fill('+91 98765 43210');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Ananya S\./ })).toBeVisible();

  // Leave the seeded account as it was.
  await name.fill(original);
  await page.getByLabel('Phone number').fill('');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
});

test('the password form rejects mismatched confirmation before calling the API', async ({ page }) => {
  await page.goto('/account');
  await page.getByLabel('Current password', { exact: true }).fill('DemoPass123!');
  await page.getByLabel('New password', { exact: true }).fill('Something1234');
  await page.getByLabel('Confirm new password').fill('Different1234');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('The new passwords do not match.')).toBeVisible();
});

test('a used or bogus verification link shows a clear error', async ({ page }) => {
  await page.goto('/verify-email?token=not-a-real-token-but-long-enough');
  await expect(page.getByRole('heading', { name: 'Email verification' })).toBeVisible();
  await expect(page.getByText(/invalid or has expired/)).toBeVisible();
});
