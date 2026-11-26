// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UploadWidget } from './UploadWidget.tsx';

const { addFiles } = vi.hoisted(() => ({ addFiles: vi.fn() }));
vi.mock('../context/AuthContext.tsx', () => ({
  useAuth: () => ({ user: { rootId: 'root-id' } }),
}));
vi.mock('./useUploadBatch.ts', () => ({
  useUploadBatch: () => ({ files: [], notice: '', addFiles, cancel: vi.fn() }),
}));

describe('selector y zona accesible de carga', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('expone selector múltiple activable con botón y arrastre con feedback', () => {
    const { container } = render(<UploadWidget />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    const choose = screen.getByRole('button', { name: 'Seleccionar archivos' });
    choose.focus();
    expect(document.activeElement).toBe(choose);
    expect(screen.getByText(/Arrastra archivos aquí/)).not.toBeNull();
    fireEvent.dragOver(screen.getByLabelText('Zona para arrastrar y soltar archivos'));
    expect(container.querySelector('.is-dragging')).not.toBeNull();
    fireEvent.drop(container.querySelector('.upload-dropzone')!, {
      dataTransfer: { files: [new File(['%PDF'], 'uno.pdf')] },
    });
    expect(addFiles).toHaveBeenCalledWith(expect.anything(), 'root-id');
  });
});
