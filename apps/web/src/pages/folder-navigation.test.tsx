// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { apiFetch } from '../api/client.ts';
import { FileList } from './FileList.tsx';

const { addFiles } = vi.hoisted(() => ({ addFiles: vi.fn() }));
vi.mock('../api/client.ts', () => ({ apiFetch: vi.fn() }));
vi.mock('../context/AuthContext.tsx', () => ({ useAuth: () => ({ user: { rootId: 'raiz' } }) }));
vi.mock('./useUploadBatch.ts', () => ({
  useUploadBatch: () => ({ files: [], notice: '', addFiles, cancel: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('crea en la ubicación abierta, apunta la carga al destino y permite volver a la raíz', async () => {
  const created = vi.fn();
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    if (path === '/api/v1/folders') {
      created(JSON.parse(options!.body as string));
      return { resource: {} } as never;
    }
    const items =
      path === '/api/v1/folders/raiz/children'
        ? [{ id: 'hija', name: 'Documentos', kind: 'FOLDER', effectivePermission: 'OWNER' }]
        : [];
    return { items, nextCursor: null } as never;
  });
  const { container } = render(<FileList rootId="raiz" title="Mi unidad" manageFolders />);
  const open = await screen.findByRole('button', { name: 'Abrir Documentos' });
  open.focus();
  expect(document.activeElement).toBe(open);
  fireEvent.click(open);
  expect(screen.getByRole('navigation', { name: 'Ubicación actual' }).textContent).toContain(
    'Documentos',
  );
  await screen.findByText('No hay archivos disponibles.');
  fireEvent.change(screen.getByRole('textbox', { name: 'Nombre de la carpeta' }), {
    target: { value: '  Nueva  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Crear carpeta' }));
  await screen.findByText('Carpeta creada');
  expect(created).toHaveBeenCalledWith({ parentId: 'hija', name: 'Nueva' });
  fireEvent.change(container.querySelector('input[type=file]')!, {
    target: { files: [new File(['texto'], 'prueba.txt')] },
  });
  expect(addFiles).toHaveBeenCalledWith(expect.anything(), 'hija');
  fireEvent.click(screen.getByRole('button', { name: 'Mi unidad' }));
  expect(await screen.findByRole('button', { name: 'Abrir Documentos' })).toBeTruthy();
});
