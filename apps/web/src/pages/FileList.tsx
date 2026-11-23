import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client.ts';
import './FileList.css';

interface Resource {
  id: string; kind: 'FILE' | 'FOLDER'; name: string; size?: number;
  effectivePermission: 'OWNER' | 'READ' | 'EDIT';
}
interface Page { items: Resource[]; nextCursor: string | null }
interface Location { id: string; name: string }

async function download(file: Resource) {
  const response = await fetch(`/api/v1/files/${file.id}/download`, {
    credentials: 'include', cache: 'no-store', headers: { Accept: 'application/octet-stream' },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(error?.message ?? 'No se pudo descargar el archivo');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function FileList({ rootId, title }: { rootId?: string; title: string }) {
  const [path, setPath] = useState<Location[]>(rootId ? [{ id: rootId, name: title }] : []);
  const [items, setItems] = useState<Resource[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const view = useRef(0);
  const moreRequest = useRef<AbortController | null>(null);
  const folderId = path.at(-1)?.id;
  const endpoint = folderId ? `/api/v1/folders/${folderId}/children` : '/api/v1/shared';

  useEffect(() => {
    const controller = new AbortController();
    view.current++;
    moreRequest.current?.abort();
    setItems([]); setCursor(null); setError(null); setLoading(true);
    void apiFetch<Page>(endpoint, { signal: controller.signal, cache: 'no-store' })
      .then((page) => { if (!controller.signal.aborted) { setItems(page.items); setCursor(page.nextCursor); } })
      .catch((cause: Error) => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { view.current++; controller.abort(); moreRequest.current?.abort(); };
  }, [endpoint, revision]);

  function invalidate() { view.current++; moreRequest.current?.abort(); }

  async function more() {
    if (!cursor || loading) return;
    const version = view.current;
    const controller = new AbortController();
    moreRequest.current = controller;
    setLoading(true); setError(null);
    try {
      const page = await apiFetch<Page>(`${endpoint}?cursor=${encodeURIComponent(cursor)}`,
        { cache: 'no-store', signal: controller.signal });
      if (controller.signal.aborted || version !== view.current) return;
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch (cause) {
      if (!controller.signal.aborted && version === view.current) setError((cause as Error).message);
    } finally {
      if (moreRequest.current === controller) moreRequest.current = null;
      if (version === view.current) setLoading(false);
    }
  }

  async function save(file: Resource) {
    setError(null);
    try { await download(file); }
    catch (cause) { setError((cause as Error).message); }
  }

  return <section className="card" aria-label={title}>
    <h2>{title}</h2>
    {path.length > (rootId ? 1 : 0) && <button type="button" onClick={() =>
      { invalidate(); setPath((current) => current.slice(0, -1)); }}>Volver</button>}
    <button type="button" onClick={() => { invalidate(); setRevision((value) => value + 1); }}>Actualizar</button>
    {loading && items.length === 0 && <p role="status">Cargando archivos…</p>}
    {!loading && items.length === 0 && !error && <p>No hay archivos disponibles.</p>}
    {error && <p role="alert">{error}</p>}
    <ul className="file-list">
      {items.map((item) => <li key={item.id}>
        <span>{item.kind === 'FOLDER' ? '📁' : '📄'} {item.name}</span>
        {item.kind === 'FILE' ? <>
          <span>{item.size?.toLocaleString('es-CL')} bytes · Disponible</span>
          <button type="button" onClick={() => { void save(item); }}>Descargar {item.name}</button>
        </> : <button type="button" onClick={() => { invalidate(); setPath((current) =>
          [...current, { id: item.id, name: item.name }]); }}>Abrir {item.name}</button>}
      </li>)}
    </ul>
    {cursor && <button type="button" disabled={loading} onClick={() => { void more(); }}>Más archivos</button>}
  </section>;
}
