import { useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { useUpload } from './useUpload.ts';

export function UploadWidget() {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const { upload, progress, error, busy, start, cancel } = useUpload();
  const state = upload?.status;
  const labels: Record<string, string> = {
    CREATED: 'Preparando carga',
    RECEIVING: 'Recibiendo archivo',
    QUEUED: 'En espera de procesamiento',
    PROCESSING: 'Guardando archivo',
    COMPLETED: 'Archivo disponible',
    FAILED: 'La carga falló',
    CANCEL_REQUESTED: 'Cancelación solicitada',
    CANCELLED: 'Carga cancelada',
  };
  return (
    <section className="card" aria-labelledby="upload-heading">
      <h2 id="upload-heading">Subir un archivo</h2>
      <input
        type="file"
        aria-label="Seleccionar archivo"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        disabled={!file || busy || !user}
        onClick={() => {
          if (file && user) void start(file, user.rootId);
        }}
      >
        Subir
      </button>
      {busy && <p>Envío HTTP: {progress}%</p>}
      {state && <p role="status">{labels[state] ?? state}</p>}
      {state && ['CREATED', 'RECEIVING', 'QUEUED', 'PROCESSING'].includes(state) && (
        <button
          type="button"
          onClick={() => {
            void cancel();
          }}
        >
          Cancelar carga
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
