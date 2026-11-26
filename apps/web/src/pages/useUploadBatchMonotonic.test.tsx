// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../api/client.ts';
import { useUploadBatch } from './useUploadBatch.ts';

let created = 0;
let grouped = 0;
const { postNames } = vi.hoisted(() => ({ postNames: [] as string[] }));
vi.mock('../api/client.ts', () => ({
  apiFetch: vi.fn(),
  fetchCsrfToken: vi.fn().mockResolvedValue('csrf'),
}));

class DelayedRequest {
  static pending = new Map<string, DelayedRequest>();
  status = 202;
  url = '';
  upload = {};
  onload?: () => void;
  onerror?: () => void;
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader() {}
  send() {
    if (this.url.endsWith('upload-c/content')) this.onload?.();
    else DelayedRequest.pending.set(this.url, this);
  }
  abort() {
    this.onerror?.();
  }
}

describe('respuestas tardías del PUT no revierten estados confirmados', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    DelayedRequest.pending.clear();
    postNames.splice(0);
    created = 0;
    grouped = 0;
  });

  it('conserva COMPLETED y CANCELLED mientras el tercer archivo completa', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 20_000));
    vi.stubGlobal('XMLHttpRequest', DelayedRequest);
    vi.mocked(apiFetch).mockImplementation(async (path, init) => {
      if (path === '/api/v1/uploads') {
        const body = JSON.parse(String(init?.body)) as { name: string };
        postNames.push(body.name);
        const id = `upload-${String.fromCharCode(97 + created++)}`;
        return { upload: { id, status: 'CREATED', size: 5 } } as never;
      }
      if (path === '/api/v1/uploads?active=true') {
        grouped++;
        return { items: [] } as never;
      }
      if (String(path).endsWith('/upload-a'))
        return { upload: { id: 'upload-a', status: 'COMPLETED' } } as never;
      if (String(path).endsWith('/upload-b'))
        return { upload: { id: 'upload-b', status: 'CANCELLED' } } as never;
      if (String(path).endsWith('/upload-c'))
        return {
          upload: { id: 'upload-c', status: grouped === 1 ? 'PROCESSING' : 'COMPLETED' },
        } as never;
      throw new Error(`Ruta inesperada: ${String(path)}`);
    });
    const view = renderHook(() => useUploadBatch());
    let sending!: Promise<void>;
    await act(async () => {
      sending = view.result.current.addFiles(
        ['a.pdf', 'b.pdf', 'c.pdf'].map((name) => new File(['12345'], name)),
        'root',
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(grouped).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(view.result.current.files.map((file) => file.status)).toEqual([
      'COMPLETED',
      'CANCELLED',
      'COMPLETED',
    ]);
    expect(DelayedRequest.pending.size).toBe(2);
    await act(async () => {
      for (const request of DelayedRequest.pending.values()) request.onload?.();
      await sending;
    });
    expect(view.result.current.files.map((file) => file.status)).toEqual([
      'COMPLETED',
      'CANCELLED',
      'COMPLETED',
    ]);
    expect(postNames).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(
      vi.mocked(apiFetch).mock.calls.filter(([path]) => path === '/api/v1/uploads?active=true'),
    ).toHaveLength(2);
  });
});
