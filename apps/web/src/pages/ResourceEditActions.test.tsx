// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ResourceEditActions } from './ResourceEditActions.tsx';
import { apiFetch } from '../api/client.ts';

vi.mock('../api/client.ts', () => ({ apiFetch: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('pide confirmación explícita y explica el impacto al editor', async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  const user = userEvent.setup();
  const onDeleted = vi.fn();
  const deletion = {
    id: 'trabajo',
    status: 'PENDING',
    affectedResources: 1,
    processedResources: 0,
  };
  vi.mocked(apiFetch).mockResolvedValueOnce({ deletion });
  render(
    <ResourceEditActions
      resource={{ id: 'archivo', name: 'Informe.txt', kind: 'FILE', effectivePermission: 'EDIT' }}
      onRenamed={vi.fn()}
      onDeleted={onDeleted}
    />,
  );
  const button = screen.getByRole('button', { name: 'Eliminar Informe.txt' });
  button.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('dialog', { name: 'Eliminar Informe.txt' })).toBeTruthy();
  expect(screen.getByText(/Se eliminará el recurso del propietario/)).toBeTruthy();
  expect(apiFetch).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Confirmar eliminación' }));
  expect(apiFetch).toHaveBeenCalledWith('/api/v1/resources/archivo?confirmRecursive=true', {
    method: 'DELETE',
  });
  expect(onDeleted).toHaveBeenCalledWith(deletion, 'Informe.txt');
});
