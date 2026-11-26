import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { apiFetch } from '../api/client.ts';
import type { BatchFile } from './useUploadBatch.ts';
import type { Upload } from './useUpload.ts';

const active = new Set(['CREATED', 'RECEIVING', 'QUEUED', 'PROCESSING', 'CANCEL_REQUESTED']);
const lastRequest = { at: 0 };

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
    let inFlight = false;
    const poll = async () => {
      if (stopped || inFlight) return;
      const wait = Math.max(0, 1000 - (Date.now() - lastRequest.at));
      if (wait) {
        timer = window.setTimeout(() => void poll(), wait);
        return;
      }
      inFlight = true;
      const started = Date.now();
      lastRequest.at = started;
      try {
        const result = await apiFetch<{ items: Upload[] }>('/api/v1/uploads?active=true');
        if (!stopped) {
          const byId = new Map(result.items.map((upload) => [upload.id, upload]));
          setFiles((current) =>
            current.map((file) => {
              const upload = file.uploadId ? byId.get(file.uploadId) : undefined;
              return upload ? { ...file, status: upload.status } : file;
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
        inFlight = false;
        if (!stopped)
          timer = window.setTimeout(() => void poll(), Math.max(0, 1000 - (Date.now() - started)));
      }
    };
    timer = window.setTimeout(() => void poll(), Math.max(0, 1000 - (Date.now() - lastRequest.at)));
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [ids, setFiles]);
}
