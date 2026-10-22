import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'DemoPass123!';

async function logIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).last().click();
}

test('anonymous visitor can browse the catalog', async ({ page }) => {
  await page.goto('/catalog');
  await expect(page.getByRole('heading', { name: 'Course catalog' })).toBeVisible();
  await expect(page.getByText('Full-Stack Web Development Bootcamp').first()).toBeVisible();
});

test('student logs in and lands on their dashboard', async ({ page }) => {
  await logIn(page, 'student@vertexon.demo');
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My courses' })).toBeVisible();
});

test('admin is routed to the admin panel', async ({ page }) => {
  await logIn(page, 'admin@vertexon.demo');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Admin panel' })).toBeVisible();
});

test('a wrong password keeps the user on the login page with an error', async ({ page }) => {
  await logIn(page, 'student@vertexon.demo', 'WrongPassword1!');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('alert').or(page.getByText(/invalid|incorrect/i)).first()).toBeVisible();
});

test('protected pages redirect to login when signed out', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login/);
});
