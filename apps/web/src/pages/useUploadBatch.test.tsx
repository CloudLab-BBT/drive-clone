// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUploadBatch } from './useUploadBatch.ts';
import { apiFetch } from '../api/client.ts';

let created = 0;
vi.mock('../api/client.ts', () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path === '/api/v1/uploads?active=true') return { items: [] };
    return { upload: { id: `upload-${++created}`, status: 'CREATED', size: 5 } };
  }),
  fetchCsrfToken: vi.fn().mockResolvedValue('csrf'),
}));

class Request {
  static active = 0;
  static maximum = 0;
  status = 202;
  upload: Record<string, (event: ProgressEvent) => void> = {};
  onload?: () => void;
  onerror?: () => void;
  open() {}
  setRequestHeader() {}
  send() {
    Request.active++;
    Request.maximum = Math.max(Request.maximum, Request.active);
    setTimeout(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 5 } as ProgressEvent);
      this.onload?.();
      Request.active--;
    }, 0);
  }
  abort() {
    this.onerror?.();
  }
}

describe('cola de carga múltiple', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    created = 0;
    Request.active = 0;
    Request.maximum = 0;
  });

  it('limita el lote a 10, anticipa errores y no bloquea archivos válidos', async () => {
    vi.stubGlobal('XMLHttpRequest', Request);
    const { result } = renderHook(() => useUploadBatch());
    const valid = new File(['12345'], 'ok.pdf');
    const invalid = new File(['bad'], 'renombrado.exe');
    const tooBig = new File([], 'unused');
    Object.defineProperty(tooBig, 'name', { value: 'grande.pdf' });
    Object.defineProperty(tooBig, 'size', { value: 104857601 });
    await act(async () => {
      await result.current.addFiles([invalid, tooBig, valid], 'root');
    });
    expect(result.current.files.map((file) => file.status)).toEqual(['FAILED', 'FAILED', 'QUEUED']);
    expect(result.current.files[0].error).toMatch(/Formato/);
    expect(result.current.files[1].error).toMatch(/100 MiB/);
    const many = Array.from({ length: 11 }, (_, i) => new File(['x'], `${i}.pdf`));
    await act(async () => {
      await result.current.addFiles(many, 'root');
    });
    expect(result.current.notice).toMatch(/máximo 10/);
    expect(created).toBe(1);
  });

  it('nunca mantiene más de tres envíos HTTP simultáneos', async () => {
    vi.stubGlobal('XMLHttpRequest', Request);
    const { result } = renderHook(() => useUploadBatch());
    const files = Array.from({ length: 10 }, (_, i) => new File(['12345'], `${i}.pdf`));
    await act(async () => {
      await result.current.addFiles(files, 'root');
    });
    expect(Request.maximum).toBe(3);
    expect(result.current.files.filter((file) => file.status === 'QUEUED')).toHaveLength(10);
  });

  it('sondea en grupo con intervalo mínimo de un segundo y se detiene al completar', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 5000));
    class ImmediateRequest extends Request {
      send() {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 5 } as ProgressEvent);
        this.onload?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', ImmediateRequest);
    const times: number[] = [];
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === '/api/v1/uploads?active=true') {
        times.push(Date.now());
        const status = times.length === 1 ? 'PROCESSING' : 'COMPLETED';
        return {
          items: [
            { id: 'upload-1', status },
            { id: 'upload-2', status },
          ],
        } as never;
      }
      return { upload: { id: `upload-${++created}`, status: 'CREATED', size: 5 } } as never;
    });
    const { result } = renderHook(() => useUploadBatch());
    await act(async () => {
      await result.current.addFiles(
        [new File(['12345'], 'one.pdf'), new File(['12345'], 'two.pdf')],
        'root',
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(times).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(times).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(times).toHaveLength(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1000);
    expect(result.current.files.map((file) => file.status)).toEqual(['COMPLETED', 'COMPLETED']);
    expect(
      vi
        .mocked(apiFetch)
        .mock.calls.filter(
          ([path]) => path !== '/api/v1/uploads' && path !== '/api/v1/uploads?active=true',
        ),
    ).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(times).toHaveLength(2);
  });
});
