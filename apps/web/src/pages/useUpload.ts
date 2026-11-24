import { useEffect, useRef, useState } from 'react';
import { apiFetch, fetchCsrfToken } from '../api/client.ts';

interface Upload {
  id: string; status: string; receivedBytes: number; size: number; errorCode?: string;
}

function sendContent(id: string, file: File, token: string, onProgress: (value: number) => void,
  onRequest: (request: XMLHttpRequest) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    onRequest(xhr);
    xhr.open('PUT', `/api/v1/uploads/${id}/content`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('x-csrf-token', token);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 202) { resolve(); return; }
      let message = 'Error al recibir el archivo';
      try { message = (JSON.parse(xhr.responseText) as { message?: string }).message ?? message; } catch { /* Respuesta vacía. */ }
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
  const inFlight = useRef(false);
  const lastPoll = useRef(0);
  const sending = useRef<XMLHttpRequest | null>(null);
  const cancelled = useRef(false);
  status.current = upload?.status;
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    if (!upload || !['CREATED', 'RECEIVING', 'QUEUED', 'PROCESSING', 'CANCEL_REQUESTED'].includes(upload.status)) return;
    let stopped = false;
    let timer: number;
    const poll = async () => {
      if (stopped || !['CREATED', 'RECEIVING', 'QUEUED', 'PROCESSING', 'CANCEL_REQUESTED'].includes(status.current ?? '')) return;
      if (inFlight.current) { timer = window.setTimeout(() => { void poll(); }, 100); return; }
      const wait = Math.max(0, 1000 - (Date.now() - lastPoll.current));
      if (wait) { timer = window.setTimeout(() => { void poll(); }, wait); return; }
      inFlight.current = true;
      lastPoll.current = Date.now();
      const started = Date.now();
      try {
        const result = await apiFetch<{ items: Upload[] }>('/api/v1/uploads?active=true');
        if (stopped) return;
        const current = result.items.find((item) => item.id === upload.id);
        if (current) setUpload((previous) => previous &&
          ['COMPLETED', 'FAILED', 'CANCELLED'].includes(previous.status) ||
          (previous?.status === 'CANCEL_REQUESTED' && current.status !== 'CANCELLED') ? previous : current);
        else {
          const final = await apiFetch<{ upload: Upload }>(`/api/v1/uploads/${upload.id}`);
          if (!stopped) setUpload(final.upload);
        }
      } catch (cause) { if (!stopped) setError((cause as Error).message); }
      finally {
        inFlight.current = false;
        if (!stopped && ['CREATED', 'RECEIVING', 'QUEUED', 'PROCESSING', 'CANCEL_REQUESTED'].includes(status.current ?? ''))
          timer = window.setTimeout(() => { void poll(); }, Math.max(0, 1000 - (Date.now() - started)));
      }
    };
    timer = window.setTimeout(() => { void poll(); }, 1000);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [upload?.id]);

  async function start(file: File, parentId: string) {
    cancelled.current = false;
    setBusy(true); setError(null); setProgress(0);
    try {
      const result = await apiFetch<{ upload: Upload }>('/api/v1/uploads', {
        method: 'POST', body: JSON.stringify({ parentId, name: file.name, size: file.size }),
      });
      if (!active.current) return;
      setUpload({ ...result.upload, status: 'RECEIVING' });
      await sendContent(result.upload.id, file, await fetchCsrfToken(), setProgress,
        (request) => { sending.current = request; });
      if (active.current) setUpload((current) => current &&
        ['COMPLETED', 'FAILED', 'CANCELLED', 'CANCEL_REQUESTED'].includes(current.status) ? current :
          current && { ...current, status: 'QUEUED' });
    } catch (cause) { if (active.current && !cancelled.current &&
      !['CANCEL_REQUESTED', 'CANCELLED'].includes(status.current ?? ''))
      setError((cause as Error).message); }
    finally { sending.current = null; if (active.current) setBusy(false); }
  }

  async function cancel() {
    if (!upload) return;
    setError(null);
    try {
      const result = await apiFetch<{ upload: Upload }>(`/api/v1/uploads/${upload.id}/cancel`,
        { method: 'POST' });
      if (!active.current) return;
      cancelled.current = true;
      setUpload(result.upload);
      sending.current?.abort();
    } catch (cause) { if (active.current) setError((cause as Error).message); }
  }

  return { upload, progress, error, busy, start, cancel };
}
