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

  it('espera la consulta pendiente aunque el PUT cambie el estado', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('XMLHttpRequest', DelayedRequest);
    let resolveFirst!: (value: { items: (typeof base)[] }) => void;
    const first = new Promise<{ items: (typeof base)[] }>((resolve) => {
      resolveFirst = resolve;
    });
    let activeCalls = 0;
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === '/api/v1/uploads') return { upload: base } as never;
      if (path === '/api/v1/uploads?active=true') {
        activeCalls++;
        return activeCalls === 1
          ? ((await first) as never)
          : ({ items: [{ ...base, status: 'PROCESSING' }] } as never);
      }
      throw new Error(`Ruta inesperada: ${path}`);
    });
    const { result } = renderHook(() => useUpload());
    let sending!: Promise<void>;
    await act(async () => {
      sending = result.current.start(new File(['1234'], 'test.pdf'), 'root-id');
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(activeCalls).toBe(1);
    await act(async () => {
      DelayedRequest.latest.onload?.();
      await sending;
    });
    expect(result.current.upload?.status).toBe('QUEUED');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(activeCalls).toBe(1);
    await act(async () => {
      resolveFirst({ items: [{ ...base, status: 'PROCESSING' }] });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(activeCalls).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(activeCalls).toBe(2);
  });
});
