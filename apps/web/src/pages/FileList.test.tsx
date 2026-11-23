// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileList } from './FileList.tsx';

vi.mock('../api/client.ts', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../api/client.ts';

const file = { id: 'file-id', kind: 'FILE', name: 'informe.pdf', size: 5,
  effectivePermission: 'OWNER' };

describe('listado y descarga en React', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

  it('muestra vacío y luego pagina datos persistidos', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ items: [], nextCursor: null } as never)
      .mockResolvedValueOnce({ items: [file], nextCursor: 'siguiente' } as never)
      .mockResolvedValueOnce({ items: [{ ...file, id: 'segundo', name: 'dos.pdf' }],
        nextCursor: null } as never);
    render(<FileList rootId="root-id" title="Mis archivos" />);
    expect(await screen.findByText('No hay archivos disponibles.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(await screen.findByRole('button', { name: 'Descargar informe.pdf' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Más archivos' }));
    expect(await screen.findByRole('button', { name: 'Descargar dos.pdf' })).toBeTruthy();
    expect(vi.mocked(apiFetch).mock.calls[2][0]).toContain('cursor=siguiente');
  });

  it('descarga por la API con sesión y muestra errores controlados', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: [file], nextCursor: null } as never);
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(new Blob(['bytes'])))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Objeto no disponible' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:prueba'),
      revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<FileList rootId="root-id" title="Mis archivos" />);
    const button = await screen.findByRole('button', { name: 'Descargar informe.pdf' });
    fireEvent.click(button);
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/files/file-id/download');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include', cache: 'no-store' });
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Objeto no disponible');
  });

  it.each(['navegar', 'actualizar'])('descarta una página tardía al %s', async (action) => {
    let resolveOld!: (page: { items: typeof file[]; nextCursor: string | null }) => void;
    const old = new Promise<{ items: typeof file[]; nextCursor: string | null }>((resolve) => {
      resolveOld = resolve;
    });
    const folder = { ...file, id: 'folder-id', kind: 'FOLDER', name: 'Carpeta' };
    const fresh = { ...file, id: 'fresh-id', name: 'nuevo.pdf' };
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (String(path).includes('cursor=viejo')) return await old as never;
      if (String(path).includes('cursor=nuevo')) return { items: [], nextCursor: null } as never;
      if (path === '/api/v1/folders/folder-id/children')
        return { items: [fresh], nextCursor: 'nuevo' } as never;
      const calls = vi.mocked(apiFetch).mock.calls.filter(([url]) => url === '/api/v1/folders/root-id/children');
      return calls.length === 1 ? { items: [folder], nextCursor: 'viejo' } as never :
        { items: [fresh], nextCursor: 'nuevo' } as never;
    });
    render(<FileList rootId="root-id" title="Mis archivos" />);
    await screen.findByRole('button', { name: 'Abrir Carpeta' });
    fireEvent.click(screen.getByRole('button', { name: 'Más archivos' }));
    fireEvent.click(screen.getByRole('button', { name: action === 'navegar' ? 'Abrir Carpeta' : 'Actualizar' }));
    await screen.findByRole('button', { name: 'Descargar nuevo.pdf' });
    await act(async () => { resolveOld({ items: [{ ...file, id: 'late', name: 'tardío.pdf' }],
      nextCursor: 'viejo-2' }); });
    expect(screen.queryByRole('button', { name: 'Descargar tardío.pdf' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Más archivos' }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.at(-1)?.[0]).toContain('cursor=nuevo'));
  });

  it('cancela la página pendiente al desmontar', async () => {
    let signal: AbortSignal | undefined;
    const pending = new Promise<never>(() => {});
    vi.mocked(apiFetch).mockImplementation(async (_path, options) => {
      if (options?.signal) signal = options.signal;
      return String(_path).includes('cursor=') ? await pending :
        { items: [file], nextCursor: 'viejo' } as never;
    });
    const view = render(<FileList rootId="root-id" title="Mis archivos" />);
    await screen.findByRole('button', { name: 'Más archivos' });
    fireEvent.click(screen.getByRole('button', { name: 'Más archivos' }));
    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
