export interface UserSummary {
  id: string;
  username: string;
  rootId: string;
}

export interface ApiErrorResponse {
  code: string;
  message: string;
  requestId: string;
  fields?: Record<string, string[]>;
}

let cachedCsrfToken: string | null = null;

export async function fetchCsrfToken(): Promise<string> {
  const response = await fetch('/api/v1/auth/csrf', {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'Error al obtener sesión y token CSRF');
  }

  const data = await response.json();
  cachedCsrfToken = data.csrfToken;
  return data.csrfToken;
}

export function clearCsrfToken(): void {
  cachedCsrfToken = null;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');

  // Si es mutación (POST, PUT, PATCH, DELETE), asegurar token CSRF y Content-Type
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (!cachedCsrfToken) {
      await fetchCsrfToken();
    }
    if (cachedCsrfToken) {
      headers.set('x-csrf-token', cachedCsrfToken);
    }
    if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (response.status === 204) {
    return null as T;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(data?.message || 'Error en la solicitud') as Error & {
      code?: string;
      status?: number;
      fields?: Record<string, string[]>;
    };
    error.code = data?.code || 'UNKNOWN_ERROR';
    error.status = response.status;
    error.fields = data?.fields;
    throw error;
  }

  return data as T;
}

export async function apiRegister(credentials: { username: string; password: string }): Promise<{ user: UserSummary }> {
  // Asegurar sesión previa y token CSRF antes de mutación
  await fetchCsrfToken();
  const result = await apiFetch<{ user: UserSummary }>('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
  // Tras regenerar sesión, refrescar token CSRF para la nueva sesión
  await fetchCsrfToken().catch(() => {});
  return result;
}

export async function apiLogin(credentials: { username: string; password: string }): Promise<{ user: UserSummary }> {
  // Asegurar sesión previa y token CSRF antes de mutación
  await fetchCsrfToken();
  const result = await apiFetch<{ user: UserSummary }>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
  // Tras regenerar sesión, refrescar token CSRF para la nueva sesión
  await fetchCsrfToken().catch(() => {});
  return result;
}

export async function apiLogout(): Promise<void> {
  try {
    await apiFetch<void>('/api/v1/auth/logout', {
      method: 'POST',
    });
  } finally {
    clearCsrfToken();
  }
}

export async function apiGetMe(): Promise<{ user: UserSummary }> {
  return apiFetch<{ user: UserSummary }>('/api/v1/auth/me', {
    method: 'GET',
  });
}
