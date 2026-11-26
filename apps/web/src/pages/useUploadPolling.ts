import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { apiFetch } from '../api/client.ts';
import type { Upload } from './useUpload.ts';
import { mergeUploadStatus } from './uploadState.ts';

export function useUploadPolling(
  upload: Upload | null,
  status: { current: string | undefined },
  setUpload: Dispatch<SetStateAction<Upload | null>>,
  setError: Dispatch<SetStateAction<string | null>>,
) {
  const inFlight = useRef(false);
  const lastPoll = useRef(0);
  useEffect(() => {
    if (
      !upload ||
      !['CREATED', 'RECEIVING', 'QUEUED', 'PROCESSING', 'CANCEL_REQUESTED'].includes(upload.status)
    )
      return;
    let stopped = false;
    let timer: number;
    const poll = async () => {
      if (
        stopped ||
        !['CREATED', 'RECEIVING', 'QUEUED', 'PROCESSING', 'CANCEL_REQUESTED'].includes(
          status.current ?? '',
        )
      )
        return;
      if (inFlight.current) {
        timer = window.setTimeout(() => {
          void poll();
        }, 100);
        return;
      }
      const wait = Math.max(0, 1000 - (Date.now() - lastPoll.current));
      if (wait) {
        timer = window.setTimeout(() => {
          void poll();
        }, wait);
        return;
      }
      inFlight.current = true;
      lastPoll.current = Date.now();
      const started = Date.now();
      try {
        const result = await apiFetch<{ items: Upload[] }>('/api/v1/uploads?active=true');
        if (stopped) return;
        const current = result.items.find((item) => item.id === upload.id);
        const latest =
          current ?? (await apiFetch<{ upload: Upload }>(`/api/v1/uploads/${upload.id}`)).upload;
        if (!stopped)
          setUpload((previous) => ({
            ...latest,
            status: mergeUploadStatus(previous?.status ?? latest.status, latest.status),
          }));
      } catch (cause) {
        if (!stopped) setError((cause as Error).message);
      } finally {
        inFlight.current = false;
        if (
          !stopped &&
          ['CREATED', 'RECEIVING', 'QUEUED', 'PROCESSING', 'CANCEL_REQUESTED'].includes(
            status.current ?? '',
          )
        )
          timer = window.setTimeout(
            () => {
              void poll();
            },
            Math.max(0, 1000 - (Date.now() - started)),
          );
      }
    };
    timer = window.setTimeout(() => {
      void poll();
    }, 1000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [upload?.id]);
}
