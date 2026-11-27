import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { useUploadBatch } from './useUploadBatch.ts';
import './UploadWidget.css';

export function UploadWidget({
  parentId,
  onCompleted,
}: { parentId?: string; onCompleted?: () => void } = {}) {
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const { files, notice, addFiles, cancel } = useUploadBatch();
  const completed = files.filter((file) => file.status === 'COMPLETED').length;
  const previousCompleted = useRef(0);
  useEffect(() => {
    if (completed > previousCompleted.current) onCompleted?.();
    previousCompleted.current = completed;
  }, [completed, onCompleted]);

  function select(selection: FileList | null) {
    if (selection && user) void addFiles(selection, parentId ?? user.rootId);
    if (input.current) input.current.value = '';
  }
  function status(fileStatus: string) {
    if (fileStatus === 'COMPLETED') return 'Almacenamiento completado: disponible en S3.';
    if (fileStatus === 'QUEUED') return 'Envío HTTP completado: archivo subido y encolado.';
    const labels: Record<string, string> = {
      WAITING: 'En espera de envío',
      RESERVING: 'Reservando carga',
      SENDING: 'Envío HTTP en curso',
      CREATED: 'Preparando carga',
      RECEIVING: 'Recibiendo archivo',
      PROCESSING: 'Procesando y almacenando',
      CANCEL_REQUESTED: 'Cancelación solicitada',
      CANCELLED: 'Carga cancelada',
      FAILED: 'La carga falló',
    };
    return labels[fileStatus] ?? fileStatus;
  }
  return (
    <section className="card" aria-labelledby="upload-heading">
      <h2 id="upload-heading">Subir archivos</h2>
      <div
        className={`upload-dropzone${dragging ? ' is-dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          select(event.dataTransfer.files);
        }}
        aria-label="Zona para arrastrar y soltar archivos"
      >
        <p>Arrastra archivos aquí o selecciónalos (máximo 10 por lote).</p>
        <button type="button" onClick={() => input.current?.click()} aria-describedby="upload-help">
          Seleccionar archivos
        </button>
        <input
          ref={input}
          id="upload-files"
          className="upload-input"
          type="file"
          multiple
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => select(event.target.files)}
        />
        <span id="upload-help">Admite los formatos indicados; máximo 100 MiB por archivo.</span>
      </div>
      {notice && <p role="alert">{notice}</p>}
      <ul className="upload-items" aria-label="Estado de los archivos seleccionados">
        {files.map((file) => (
          <li key={file.id}>
            <strong>{file.name}</strong>
            <progress value={file.progress} max={100} aria-label={`Progreso de ${file.name}`} />
            <span role={file.error ? 'alert' : 'status'}>{file.error ?? status(file.status)}</span>
            {file.error && <span className="upload-error">{file.error}</span>}
            {file.uploadId &&
              ['SENDING', 'CREATED', 'RECEIVING', 'QUEUED', 'PROCESSING'].includes(file.status) && (
                <button type="button" onClick={() => void cancel(file)}>
                  Cancelar {file.name}
                </button>
              )}
          </li>
        ))}
      </ul>
    </section>
  );
}
