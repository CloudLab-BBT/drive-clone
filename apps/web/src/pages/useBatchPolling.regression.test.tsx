// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { apiFetch } from '../api/client.ts';
import { useBatchPolling } from './useBatchPolling.ts';
import type { BatchFile } from './useUploadBatch.ts';

vi.mock('../api/client.ts', () => ({ apiFetch: vi.fn() }));

const tracked: BatchFile = {
  id: 'local-a',
  uploadId: 'server-a',
  name: 'a.pdf',
  size: 5,
  progress: 100,
  status: 'QUEUED',
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function harness(initial = [tracked]) {
  return renderHook(() => {
    const [files, setFiles] = useState(initial);
    useBatchPolling(files, setFiles);
    return files;
  });
}

describe('resolución agrupada de IDs ausentes', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('resuelve un ID desaparecido sin solapar peticiones y se detiene al quedar terminal', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 60_000));
    const missing = deferred<{ items: Array<{ id: string; status: string }> }>();
    const terminal = deferred<{ upload: { id: string; status: string } }>();
    let grouped = 0;
    let point = 0;
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === '/api/v1/uploads?active=true') {
        grouped++;
        return grouped === 1
          ? ({ items: [{ id: 'server-a', status: 'PROCESSING' }] } as never)
          : ((await missing.promise) as never);
      }
      point++;
      return (await terminal.promise) as never;
    });
    const view = harness();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(grouped).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(grouped).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(point).toBe(0);
    expect(grouped).toBe(2);
    await act(async () => {
      missing.resolve({ items: [] });
      await Promise.resolve();
    });
    expect(point).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(grouped).toBe(2);
    expect(point).toBe(1);
    await act(async () => {
      terminal.resolve({ upload: { id: 'server-a', status: 'COMPLETED' } });
      await Promise.resolve();
    });
    expect(view.result.current[0].status).toBe('COMPLETED');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(grouped).toBe(2);
    view.unmount();
  });

  it('limpia el ciclo al desmontar mientras el sondeo está en vuelo', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 120_000));
    const response = deferred<{ items: Array<{ id: string; status: string }> }>();
    vi.mocked(apiFetch).mockImplementation(async () => (await response.promise) as never);
    const view = harness();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => {
      response.resolve({ items: [] });
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(1);
  });
});
