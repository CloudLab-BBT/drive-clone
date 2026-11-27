// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { apiFetch } from '../api/client.ts';
import { ShareAction } from './ShareAction.tsx';

vi.mock('../api/client.ts', () => ({ apiFetch: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('permite modificar y muestra el acceso heredado que sobrevive a la revocación', async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  const user = userEvent.setup();
  const grant = {
    userId: 'receptor-id',
    username: 'receptor',
    permission: 'READ',
    effectivePermission: 'EDIT',
  };
  vi.mocked(apiFetch)
    .mockResolvedValueOnce({ items: [grant], nextCursor: null })
    .mockResolvedValueOnce({ share: { ...grant, permission: 'EDIT' } })
    .mockResolvedValueOnce({ items: [{ ...grant, permission: 'EDIT' }], nextCursor: null })
    .mockResolvedValueOnce({ remainingPermission: 'EDIT' })
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  render(<ShareAction resource={{ id: 'recurso', name: 'Documentos' }} />);
  const trigger = screen.getByRole('button', { name: 'Compartir Documentos' });
  trigger.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('dialog', { name: 'Compartir Documentos' })).toBeTruthy();
  expect(await screen.findByText(/Efectivo: Edición/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Modificar receptor' }));
  await user.selectOptions(screen.getByLabelText('Permiso'), 'EDIT');
  await user.click(screen.getByRole('button', { name: 'Guardar permiso' }));
  expect(await screen.findByText(/Directo: Edición/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Revocar receptor' }));
  expect(await screen.findByText(/Conserva acceso heredado de edición/)).toBeTruthy();
  await waitFor(() => expect(screen.queryByText(/Directo: Edición/)).toBeNull());
  expect(apiFetch).toHaveBeenCalledWith('/api/v1/resources/recurso/shares/receptor-id', {
    method: 'DELETE',
  });
});
