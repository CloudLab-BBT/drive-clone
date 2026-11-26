import { useEffect, useRef, useState } from 'react';
import { useUploadPolling } from './useUploadPolling.ts';
import { apiFetch, fetchCsrfToken } from '../api/client.ts';

export interface Upload {
  id: string;
  status: string;
  receivedBytes: number;
  size: number;
  errorCode?: string;
}

export function sendContent(
  id: string,
  file: File,
  token: string,
  onProgress: (value: number) => void,
  onRequest: (request: XMLHttpRequest) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    onRequest(xhr);
    xhr.open('PUT', `/api/v1/uploads/${id}/content`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('x-csrf-token', token);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 202) {
        resolve();
        return;
      }
      let message = 'Error al recibir el archivo';
      try {
        message = (JSON.parse(xhr.responseText) as { message?: string }).message ?? message;
      } catch {
        /* Respuesta vacía. */
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('Se interrumpió el envío'));
    const body = new FormData();
    body.append('file', file);
    xhr.send(body);
  });
}

export function useUpload() {
  const [upload, setUpload] = useState<Upload | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const status = useRef(upload?.status);
  const sending = useRef<XMLHttpRequest | null>(null);
  const cancelled = useRef(false);
  status.current = upload?.status;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useUploadPolling(upload, status, setUpload, setError);

  async function start(file: File, parentId: string) {
    cancelled.current = false;
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const result = await apiFetch<{ upload: Upload }>('/api/v1/uploads', {
        method: 'POST',
        body: JSON.stringify({ parentId, name: file.name, size: file.size }),
      });
      if (!active.current) return;
      setUpload({ ...result.upload, status: 'RECEIVING' });
      await sendContent(result.upload.id, file, await fetchCsrfToken(), setProgress, (request) => {
        sending.current = request;
      });
      if (active.current)
        setUpload((current) =>
          current &&
          ['COMPLETED', 'FAILED', 'CANCELLED', 'CANCEL_REQUESTED'].includes(current.status)
            ? current
            : current && { ...current, status: 'QUEUED' },
        );
    } catch (cause) {
      if (
        active.current &&
        !cancelled.current &&
        !['CANCEL_REQUESTED', 'CANCELLED'].includes(status.current ?? '')
      )
        setError((cause as Error).message);
    } finally {
      sending.current = null;
      if (active.current) setBusy(false);
    }
  }

  async function cancel() {
    if (!upload) return;
    setError(null);
    try {
      const result = await apiFetch<{ upload: Upload }>(`/api/v1/uploads/${upload.id}/cancel`, {
        method: 'POST',
      });
      if (!active.current) return;
      cancelled.current = true;
      setUpload(result.upload);
      sending.current?.abort();
    } catch (cause) {
      if (active.current) setError((cause as Error).message);
    }
  }

  return { upload, progress, error, busy, start, cancel };
}
