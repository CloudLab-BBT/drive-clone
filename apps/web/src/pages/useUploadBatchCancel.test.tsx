// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUploadBatch } from './useUploadBatch.ts';
import { apiFetch } from '../api/client.ts';

vi.mock('../api/client.ts', () => ({
  apiFetch: vi.fn(async (path: string) =>
    path.endsWith('/cancel')
      ? { upload: { id: 'server-1', status: 'CANCEL_REQUESTED', size: 5 } }
      : { upload: { id: 'server-1', status: 'CREATED', size: 5 } },
  ),
  fetchCsrfToken: vi.fn().mockResolvedValue('csrf'),
}));

class PendingRequest {
  upload = {};
  onerror?: () => void;
  open() {}
  setRequestHeader() {}
  send() {}
  abort() {
    this.onerror?.();
  }
}

describe('cancelación durante envío batch', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('aborta solo el archivo pedido y conserva su estado de cancelación', async () => {
    vi.stubGlobal('XMLHttpRequest', PendingRequest);
    const { result } = renderHook(() => useUploadBatch());
    let sending!: Promise<void>;
    await act(async () => {
      sending = result.current.addFiles([new File(['12345'], 'cancelar.pdf')], 'root');
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.files[0].status).toBe('SENDING'));
    await act(async () => {
      await result.current.cancel(result.current.files[0]);
      await sending;
    });
    expect(result.current.files[0].status).toBe('CANCEL_REQUESTED');
    expect(vi.mocked(apiFetch).mock.calls.some(([path]) => String(path).endsWith('/cancel'))).toBe(
      true,
    );
  });
});
