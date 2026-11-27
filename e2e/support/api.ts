import type { Page } from '@playwright/test';

export async function api(
  page: Page,
  path: string,
  method = 'GET',
  body?: Record<string, unknown>,
) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const headers: Record<string, string> = {};
      if (body) headers['content-type'] = 'application/json';
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const csrf = await fetch('/api/v1/auth/csrf').then((response) => response.json());
        headers['x-csrf-token'] = csrf.csrfToken;
      }
      const response = await fetch(path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    { path, method, body },
  );
}
