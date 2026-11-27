import { useRef, useState } from 'react';
import { useFilePage, type Resource } from './useFilePage.ts';
import { FolderForm } from './FolderForm.tsx';
import { UploadWidget } from './UploadWidget.tsx';
import { download } from './downloadFile.ts';
import { ResourceRow } from './ResourceRow.tsx';
import { DeletionNotice, type Deletion } from './DeletionNotice.tsx';
import './FileList.css';

interface Location {
  id: string;
  name: string;
}

export function FileList({
  rootId,
  title,
  manageFolders,
}: {
  rootId?: string;
  title: string;
  manageFolders?: boolean;
}) {
  const [path, setPath] = useState<Location[]>(rootId ? [{ id: rootId, name: title }] : []);
  const folderId = path.at(-1)?.id;
  const endpoint = folderId ? `/api/v1/folders/${folderId}/children` : '/api/v1/shared';

  const { items, cursor, loading, error, setError, invalidate, refresh, more } =
    useFilePage(endpoint);
  const [deletions, setDeletions] = useState<{ job: Deletion; name: string }[]>([]);
  function track(job: Deletion, name: string) {
    setDeletions((current) => [...current.filter((item) => item.job.id !== job.id), { job, name }]);
    refresh();
  }
  const heading = useRef<HTMLHeadingElement>(null);

  async function save(file: Resource) {
    setError(null);
    try {
      await download(file);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <section className="card" aria-label={title}>
      <h2 tabIndex={-1} ref={heading}>
        {title}
      </h2>
      {folderId && (
        <>
          <nav className="folder-location" aria-label="Ubicación actual">
            {path.map((location, index) =>
              index === path.length - 1 ? (
                <span key={location.id} aria-current="location">
                  {location.name}
                </span>
              ) : (
                <button
                  key={location.id}
                  type="button"
                  onClick={() => {
                    invalidate();
                    heading.current?.focus();
                    setPath((current) => current.slice(0, index + 1));
                  }}
                >
                  {location.name}
                </button>
              ),
            )}
          </nav>
          {manageFolders && (
            <>
              <FolderForm key={folderId} parentId={folderId} onCreated={refresh} />
              <UploadWidget parentId={folderId} onCompleted={refresh} />
            </>
          )}
        </>
      )}
      {path.length > (rootId ? 1 : 0) && (
        <button
          type="button"
          onClick={() => {
            invalidate();
            heading.current?.focus();
            setPath((current) => current.slice(0, -1));
          }}
        >
          Volver
        </button>
      )}
      <button type="button" onClick={refresh}>
        Actualizar
      </button>
      {loading && items.length === 0 && <p role="status">Cargando archivos…</p>}
      {!loading && items.length === 0 && !error && <p>No hay archivos disponibles.</p>}
      {error && <p role="alert">{error}</p>}
      {deletions.length > 0 && (
        <ul aria-label="Eliminaciones solicitadas">
          {deletions.map(({ job, name }) => (
            <DeletionNotice
              key={job.id}
              initial={job}
              name={name}
              dismiss={() =>
                setDeletions((items) => items.filter((item) => item.job.id !== job.id))
              }
            />
          ))}
        </ul>
      )}
      <ul className="file-list">
        {items.map((item) => (
          <ResourceRow
            key={item.id}
            item={item}
            ownList={manageFolders}
            open={() => {
              invalidate();
              heading.current?.focus();
              setPath((current) => [...current, { id: item.id, name: item.name }]);
            }}
            save={() => void save(item)}
            refresh={refresh}
            track={track}
          />
        ))}
      </ul>
      {cursor && (
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            void more();
          }}
        >
          Más archivos
        </button>
      )}
    </section>
  );
}
