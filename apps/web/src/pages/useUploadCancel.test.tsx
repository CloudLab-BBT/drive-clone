// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUpload } from './useUpload.ts';

vi.mock('../api/client.ts', () => ({
  apiFetch: vi.fn(),
  fetchCsrfToken: vi.fn().mockResolvedValue('csrf-de-prueba'),
}));
import { apiFetch } from '../api/client.ts';

const base = { id: 'upload-id', status: 'CREATED', size: 8, receivedBytes: 0 };

class FakeRequest {
  status = 202;
  upload: { onprogress?: (event: ProgressEvent) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  open() {}
  setRequestHeader() {}
  abort() {
    this.onerror?.();
  }
  send() {
    this.upload.onprogress?.({ lengthComputable: true, loaded: 8, total: 8 } as ProgressEvent);
    this.onload?.();
  }
}

class DelayedRequest extends FakeRequest {
  static latest: DelayedRequest;
  send() {
    DelayedRequest.latest = this;
  }
}

describe('consulta agrupada de carga en la interfaz', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('conserva la cancelación confirmada aunque el PUT termine después', async () => {
    vi.stubGlobal('XMLHttpRequest', DelayedRequest);
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === '/api/v1/uploads') return { upload: base } as never;
      if (path === '/api/v1/uploads/upload-id/cancel')
        return { upload: { ...base, status: 'CANCEL_REQUESTED' } } as never;
      throw new Error(`Ruta inesperada: ${path}`);
    });
    const { result } = renderHook(() => useUpload());
    let sending!: Promise<void>;
    await act(async () => {
      sending = result.current.start(new File(['1234'], 'test.pdf'), 'root-id');
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.cancel();
      await sending;
    });
    expect(result.current.upload?.status).toBe('CANCEL_REQUESTED');
    expect(result.current.error).toBeNull();
  });
});
