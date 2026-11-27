import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.ts';

export interface Deletion {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  affectedResources: number;
  processedResources: number;
}

export function DeletionNotice({
  initial,
  name,
  dismiss,
}: {
  initial: Deletion;
  name: string;
  dismiss: () => void;
}) {
  const [job, setJob] = useState(initial);
  const [error, setError] = useState(false);
  const terminal = job.status === 'FAILED' || job.status === 'COMPLETED';
  useEffect(() => {
    if (terminal) return;
    const controller = new AbortController();
    let timer: number;
    async function poll() {
      try {
        const { deletion } = await apiFetch<{ deletion: Deletion }>(
          `/api/v1/deletions/${initial.id}`,
          { signal: controller.signal, cache: 'no-store' },
        );
        if (!controller.signal.aborted) {
          setJob(deletion);
          setError(false);
          if (deletion.status === 'COMPLETED' || deletion.status === 'FAILED') return;
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
      if (!controller.signal.aborted) timer = window.setTimeout(() => void poll(), 1000);
    }
    timer = window.setTimeout(() => void poll(), 1000);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [initial.id, terminal]);

  const labels = {
    PENDING: 'Eliminación pendiente',
    PROCESSING: 'Eliminación en curso',
    COMPLETED: 'Eliminación completada',
    FAILED: 'Eliminación fallida. El recurso sigue inaccesible y requiere revisión.',
  };
  return (
    <li>
      <span role={job.status === 'FAILED' ? 'alert' : 'status'}>
        {labels[job.status]} · {name} · {job.processedResources}/{job.affectedResources}
      </span>
      {error && <p role="alert">No se pudo consultar el estado. Se volverá a intentar.</p>}
      {terminal && (
        <button type="button" onClick={dismiss}>
          Cerrar aviso de {name}
        </button>
      )}
    </li>
  );
}
