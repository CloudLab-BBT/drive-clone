import { expect, test } from '@playwright/test';

test('sesión inválida redirige y los errores de acceso son visibles', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: 'drive_session',
      value: 'sesion-invalida',
      url: `${process.env.BASE_URL ?? 'http://127.0.0.1:8080'}/api/v1`,
    },
  ]);
  const page = await context.newPage();
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByText('El nombre de usuario es obligatorio')).toBeVisible();
  await expect(page.getByText('La contraseña es obligatoria')).toBeVisible();
  await expect(page.getByLabel('Nombre de usuario')).toHaveAttribute('aria-invalid', 'true');
  await context.close();
});
