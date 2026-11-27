import { useRef, useState } from 'react';
import { apiFetch, fetchCsrfToken } from '../api/client.ts';
import { sendContent, type Upload } from './useUpload.ts';
import { createUploadLimiter } from './uploadLimiter.ts';
import { useBatchPolling } from './useBatchPolling.ts';
import { mergeUploadStatus } from './uploadState.ts';

const formats = new Set(
  'png jpg jpeg webp raw dng mp3 wav ogg m4a flac mp4 webm mov pdf doc docx ppt pptx xls xlsx odt ods odp txt csv'.split(
    ' ',
  ),
);
const maxBytes = 100 * 1024 * 1024;
const activeStates = new Set(['CREATED', 'RECEIVING', 'QUEUED', 'PROCESSING', 'CANCEL_REQUESTED']);

export interface BatchFile {
  id: string;
  name: string;
  size: number;
  progress: number;
  error?: string;
  uploadId?: string;
  status: string;
}

export function useUploadBatch() {
  const [files, setFiles] = useState<BatchFile[]>([]);
  const [notice, setNotice] = useState('');
  const limit = useRef(createUploadLimiter(3));
  const requests = useRef(new Map<string, XMLHttpRequest>());
  const cancelled = useRef(new Set<string>());
  useBatchPolling(files, setFiles);

  function update(id: string, patch: Partial<BatchFile>) {
    setFiles((current) =>
      current.map((file) =>
        file.id === id
          ? {
              ...file,
              ...patch,
              ...(patch.status ? { status: mergeUploadStatus(file.status, patch.status) } : {}),
            }
          : file,
      ),
    );
  }

  async function addFiles(selection: FileList | File[], parentId: string) {
    const selected = Array.from(selection);
    if (selected.length > 10) {
      setNotice('Puedes seleccionar como máximo 10 archivos por lote.');
      return;
    }
    setNotice('');
    const queued = selected
      .map((file) => {
        const id =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
        const error = !formats.has(extension)
          ? 'Formato no admitido.'
          : file.size > maxBytes
            ? 'El archivo supera el límite de 100 MiB.'
            : undefined;
        const item: BatchFile = {
          id,
          name: file.name,
          size: file.size,
          progress: 0,
          status: error ? 'FAILED' : 'WAITING',
          ...(error ? { error } : {}),
        };
        setFiles((current) => [...current, item]);
        return { file, item };
      })
      .filter(({ item }) => item.status === 'WAITING');
    await Promise.all(
      queued.map(({ file, item }) =>
        limit.current(async () => {
          try {
            update(item.id, { status: 'RESERVING' });
            const created = await apiFetch<{ upload: Upload }>('/api/v1/uploads', {
              method: 'POST',
              body: JSON.stringify({ parentId, name: file.name, size: file.size }),
            });
            update(item.id, { uploadId: created.upload.id, status: 'SENDING' });
            await sendContent(
              created.upload.id,
              file,
              await fetchCsrfToken(),
              (progress) => update(item.id, { progress }),
              (request) => requests.current.set(item.id, request),
            );
            update(item.id, { status: 'QUEUED', progress: 100 });
          } catch (cause) {
            if (!cancelled.current.has(item.id))
              update(item.id, { status: 'FAILED', error: (cause as Error).message });
          } finally {
            requests.current.delete(item.id);
          }
        }),
      ),
    );
  }

  async function cancel(item: BatchFile) {
    if (!item.uploadId || (!activeStates.has(item.status) && item.status !== 'SENDING')) return;
    cancelled.current.add(item.id);
    try {
      const response = await apiFetch<{ upload: Upload }>(
        `/api/v1/uploads/${item.uploadId}/cancel`,
        {
          method: 'POST',
        },
      );
      update(item.id, { status: response.upload.status });
      requests.current.get(item.id)?.abort();
    } catch (cause) {
      cancelled.current.delete(item.id);
      update(item.id, { error: (cause as Error).message });
    }
  }
  return { files, notice, addFiles, cancel };
}
