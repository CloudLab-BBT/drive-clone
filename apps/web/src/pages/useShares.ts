import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client.ts';

export type Permission = 'READ' | 'EDIT';
interface Grant {
  userId: string;
  username: string;
  permission: Permission;
  effectivePermission?: Permission | null;
}
interface Page {
  items: Grant[];
  nextCursor: string | null;
}

export function useShares(resourceId: string) {
  const endpoint = `/api/v1/resources/${resourceId}/shares`;
  const [page, setPage] = useState<Page>({ items: [], nextCursor: null });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(true);
  const mounted = useRef(false);
  const load = useCallback(
    async (cursor?: string, signal?: AbortSignal) => {
      const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const next = await apiFetch<Page>(endpoint + suffix, { signal, cache: 'no-store' });
      if (mounted.current && !signal?.aborted)
        setPage((current) => ({
          nextCursor: next.nextCursor,
          items: cursor ? [...current.items, ...next.items] : next.items,
        }));
    },
    [endpoint],
  );

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(undefined, controller.signal)
      .catch((cause: Error) => {
        if (!controller.signal.aborted) setError(cause.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [load]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function grant(username: string, permission: Permission) {
    return run(async () => {
      await apiFetch(endpoint, { method: 'PUT', body: JSON.stringify({ username, permission }) });
      if (mounted.current) setNotice(`Permiso guardado para ${username}.`);
      await load();
    });
  }

  function revoke(userId: string, username: string) {
    return run(async () => {
      const result = await apiFetch<{ remainingPermission: Permission | null }>(
        `${endpoint}/${userId}`,
        { method: 'DELETE' },
      );
      if (mounted.current)
        setNotice(
          result.remainingPermission
            ? `Concesión de ${username} revocada. Conserva acceso heredado de ${permissionLabel(result.remainingPermission).toLowerCase()}.`
            : `Acceso de ${username} revocado para futuras solicitudes.`,
        );
      await load();
    });
  }

  return {
    page,
    notice,
    error,
    busy,
    grant,
    revoke,
    more: () => run(() => load(page.nextCursor ?? undefined)),
  };
}

export function permissionLabel(permission: Permission) {
  return permission === 'EDIT' ? 'Edición' : 'Lectura';
}
