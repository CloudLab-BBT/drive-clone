import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { apiFetch } from '../api/client.ts';
import type { BatchFile } from './useUploadBatch.ts';
import type { Upload } from './useUpload.ts';
import { mergeUploadStatus } from './uploadState.ts';

const active = new Set([
  'SENDING',
  'CREATED',
  'RECEIVING',
  'QUEUED',
  'PROCESSING',
  'CANCEL_REQUESTED',
]);
let requestInFlight = false;
let lastPoll = 0;

export function useBatchPolling(
  files: BatchFile[],
  setFiles: Dispatch<SetStateAction<BatchFile[]>>,
) {
  const ids = files
    .filter((file) => file.uploadId && active.has(file.status))
    .map((file) => file.uploadId!)
    .sort()
    .join(',');
  useEffect(() => {
    if (!ids) return;
    let stopped = false;
    let timer = 0;
    const tracked = ids.split(',');
    const schedule = (started: number) => {
      if (!stopped)
        timer = window.setTimeout(() => void poll(), Math.max(0, 1000 - (Date.now() - started)));
    };
    const poll = async () => {
      if (stopped) return;
      if (requestInFlight) {
        timer = window.setTimeout(() => void poll(), 100);
        return;
      }
      const delay = Math.max(0, 1000 - (Date.now() - lastPoll));
      if (delay) {
        timer = window.setTimeout(() => void poll(), delay);
        return;
      }
      requestInFlight = true;
      const started = Date.now();
      lastPoll = started;
      try {
        const result = await apiFetch<{ items: Upload[] }>('/api/v1/uploads?active=true');
        const states = new Map(result.items.map((upload) => [upload.id, upload]));
        for (const id of tracked) {
          if (stopped) return;
          if (states.has(id)) continue;
          const current = await apiFetch<{ upload: Upload }>(`/api/v1/uploads/${id}`);
          states.set(id, current.upload);
        }
        if (!stopped) {
          setFiles((current) =>
            current.map((file) => {
              const status = file.uploadId ? states.get(file.uploadId)?.status : undefined;
              return status ? { ...file, status: mergeUploadStatus(file.status, status) } : file;
            }),
          );
        }
      } catch (cause) {
        if (!stopped)
          setFiles((current) =>
            current.map((file) =>
              file.uploadId && active.has(file.status)
                ? { ...file, error: (cause as Error).message }
                : file,
            ),
          );
      } finally {
        requestInFlight = false;
        schedule(started);
      }
    };
    timer = window.setTimeout(() => void poll(), Math.max(0, 1000 - (Date.now() - lastPoll)));
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [ids, setFiles]);
}
