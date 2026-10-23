import { expect, test, type Page } from '@playwright/test';
import fs from 'fs';
import { SESSIONS_FILE } from '../global-setup';

/** New features through the real UI: password reset, photo, data export, flashcards, live classes. */

type Session = { access_token: string; refresh_token: string; user: unknown };
const fixtures = () =>
  JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')) as {
    sessions: Record<string, Session>;
    ids: { course: string };
  };

async function as(page: Page, role: 'student' | 'instructor') {
  await page.addInitScript((s) => {
    localStorage.setItem('lms.access_token', s.access_token);
    localStorage.setItem('lms.refresh_token', s.refresh_token);
    localStorage.setItem('lms.user', JSON.stringify(s.user));
  }, fixtures().sessions[role]);
}

test('forgot password is reachable from log in and confirms without revealing accounts', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByLabel('Email').fill('nobody-here@example.com');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText(/a reset link is on its way/)).toBeVisible();
});

test('a bad reset link explains itself', async ({ page }) => {
  await page.goto('/reset-password?token=not-a-real-token-but-long-enough');
  await page.getByLabel('New password', { exact: true }).fill('Something1234');
  await page.getByLabel('Confirm new password').fill('Something1234');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByText(/invalid or has expired/)).toBeVisible();
});

test('a learner uploads a profile photo and downloads their data', async ({ page }) => {
  await as(page, 'student');
  await page.goto('/account');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.locator('#acct-photo').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('Photo updated.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Your profile photo' })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my data (JSON)' }).click();
  expect((await download).suggestedFilename()).toBe('vertexon-my-data.json');

  await page.getByRole('button', { name: 'Remove photo' }).click();
  await expect(page.getByRole('img', { name: 'Your profile photo' })).toHaveCount(0);
});

test('the delete button stays disabled until DELETE is typed', async ({ page }) => {
  await as(page, 'student');
  await page.goto('/account');
  const del = page.getByRole('button', { name: 'Delete my account' });
  await expect(del).toBeDisabled();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await expect(del).toBeEnabled();
});

test('flashcard review is linked from the header', async ({ page }) => {
  await as(page, 'student');
  await page.goto('/');
  await page.getByRole('link', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Flashcard review' })).toBeVisible();
});

test('an instructor schedules a live class and an enrolled learner can join it', async ({ page, browser }) => {
  const { ids } = fixtures();
  await as(page, 'instructor');
  await page.goto(`/catalog/${ids.course}`);
  const title = `Office hours ${Date.now()}`;
  await page.getByLabel('Title', { exact: true }).fill(title);
  const soon = new Date(Date.now() + 5 * 60_000);
  const local = new Date(soon.getTime() - soon.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await page.getByLabel('Starts at').fill(local);
  await page.getByLabel('Meeting link (Google Meet, Zoom, Teams…)').fill('https://meet.google.com/abc-defg-hij');
  await page.getByRole('button', { name: 'Schedule and notify learners' }).click();
  await expect(page.getByText(title)).toBeVisible();

  const student = await browser.newPage();
  await as(student, 'student');
  await student.goto(`/catalog/${ids.course}`);
  const card = student.locator('section[aria-label="Live classes"]').getByText(title);
  await expect(card).toBeVisible();
  await expect(student.getByRole('button', { name: 'Join live class' }).first()).toBeVisible();
  await student.close();
});
