import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client.ts';

export interface Resource {
  id: string;
  kind: 'FILE' | 'FOLDER';
  name: string;
  size?: number;
  effectivePermission: 'OWNER' | 'READ' | 'EDIT';
}
interface Page {
  items: Resource[];
  nextCursor: string | null;
}

export function useFilePage(endpoint: string) {
  const [items, setItems] = useState<Resource[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const view = useRef(0);
  const moreRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    view.current++;
    moreRequest.current?.abort();
    setItems([]);
    setCursor(null);
    setError(null);
    setLoading(true);
    void apiFetch<Page>(endpoint, { signal: controller.signal, cache: 'no-store' })
      .then((page) => {
        if (!controller.signal.aborted) {
          setItems(page.items);
          setCursor(page.nextCursor);
        }
      })
      .catch((cause: Error) => {
        if (!controller.signal.aborted) setError(cause.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      view.current++;
      controller.abort();
      moreRequest.current?.abort();
    };
  }, [endpoint, revision]);

  function invalidate() {
    view.current++;
    moreRequest.current?.abort();
  }

  function refresh() {
    invalidate();
    setRevision((value) => value + 1);
  }

  async function more() {
    if (!cursor || loading) return;
    const version = view.current;
    const controller = new AbortController();
    moreRequest.current = controller;
    setLoading(true);
    setError(null);
    try {
      const page = await apiFetch<Page>(`${endpoint}?cursor=${encodeURIComponent(cursor)}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (controller.signal.aborted || version !== view.current) return;
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch (cause) {
      if (!controller.signal.aborted && version === view.current)
        setError((cause as Error).message);
    } finally {
      if (moreRequest.current === controller) moreRequest.current = null;
      if (version === view.current) setLoading(false);
    }
  }

  return { items, cursor, loading, error, setError, invalidate, refresh, more };
}
