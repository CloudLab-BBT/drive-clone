// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
});
