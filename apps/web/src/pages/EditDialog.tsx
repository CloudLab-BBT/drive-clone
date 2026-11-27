import { useEffect, useId, useRef, useState } from 'react';
import { apiFetch } from '../api/client.ts';
import type { Deletion } from './DeletionNotice.tsx';
import type { Resource } from './useFilePage.ts';
import type { EditActionProps, Mode } from './ResourceEditActions.tsx';

export function EditDialog({
  resource,
  mode,
  onClose,
  onRenamed,
  onDeleted,
}: EditActionProps & { mode: Mode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const summary = useId();
  const [name, setName] = useState(resource.name);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [impact, setImpact] = useState('');
  const deleting = mode === 'delete';

  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (!deleting || resource.kind !== 'FOLDER') return;
    const controller = new AbortController();
    void apiFetch<{ items: Resource[]; nextCursor: string | null }>(
      `/api/v1/folders/${resource.id}/children`,
      { signal: controller.signal },
    )
      .then(({ items, nextCursor }) => {
        if (!controller.signal.aborted)
          setImpact(
            `Contenido visible en el primer nivel: ${items.length}${nextCursor ? ' o más' : ''}.`,
          );
      })
      .catch(() => {
        if (!controller.signal.aborted) setImpact('No se pudo consultar el contenido visible.');
      });
    return () => controller.abort();
  }, [deleting, resource.id, resource.kind]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const endpoint = `/api/v1/resources/${resource.id}`;
      if (deleting) {
        const { deletion } = await apiFetch<{ deletion: Deletion }>(
          endpoint + '?confirmRecursive=true',
          { method: 'DELETE' },
        );
        onDeleted(deletion, resource.name);
      } else {
        await apiFetch(endpoint, {
          method: 'PATCH',
          body: JSON.stringify({ name: name.normalize('NFC').trim() }),
        });
        onRenamed();
      }
      dialog.current?.close();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      className="share-dialog"
      ref={dialog}
      aria-labelledby={title}
      aria-describedby={deleting ? summary : undefined}
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
    >
      <h2 id={title}>
        {deleting ? 'Eliminar' : 'Renombrar'} {resource.name}
      </h2>
      {deleting && (
        <div id={summary}>
          <p>
            {resource.kind === 'FOLDER'
              ? 'Se eliminará la carpeta y todo su contenido, incluidas las subcarpetas. Las cargas afectadas se cancelarán.'
              : 'Se eliminará este archivo y dejará de estar disponible para nuevas descargas.'}
          </p>
          {impact && <p>{impact} El total puede cambiar antes de confirmar.</p>}
          {resource.effectivePermission === 'EDIT' && (
            <p>Se eliminará el recurso del propietario y para todas las personas con acceso.</p>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {!deleting && (
          <label>
            Nuevo nombre
            <input value={name} required onChange={(event) => setName(event.target.value)} />
          </label>
        )}
        <button type="button" disabled={busy} onClick={() => dialog.current?.close()}>
          Cancelar
        </button>
        <button type="submit" disabled={busy}>
          {deleting ? 'Confirmar eliminación' : 'Guardar nombre'}
        </button>
      </form>
    </dialog>
  );
}
