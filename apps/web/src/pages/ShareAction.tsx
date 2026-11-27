import { useEffect, useId, useRef, useState } from 'react';
import { permissionLabel, useShares, type Permission } from './useShares.ts';

export function ShareAction({ resource }: { resource: { id: string; name: string } }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={trigger} type="button" onClick={() => setOpen(true)}>
        Compartir {resource.name}
      </button>
      {open && (
        <ShareDialog
          resource={resource}
          onClose={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      )}
    </>
  );
}

function ShareDialog({
  resource,
  onClose,
}: {
  resource: { id: string; name: string };
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const label = useId();
  const [username, setUsername] = useState('');
  const [permission, setPermission] = useState<Permission>('READ');
  const { page, notice, error, busy, grant, revoke, more } = useShares(resource.id);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog className="share-dialog" ref={dialog} aria-labelledby={label} onClose={onClose}>
      <h2 id={label}>Compartir {resource.name}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void grant(username.trim(), permission);
        }}
      >
        <label>
          Nombre de usuario
          <input value={username} onChange={(event) => setUsername(event.target.value)} required />
        </label>
        <label>
          Permiso
          <select
            value={permission}
            onChange={(event) => setPermission(event.target.value as Permission)}
          >
            <option value="READ">Lectura</option>
            <option value="EDIT">Edición</option>
          </select>
        </label>
        <button type="submit" disabled={busy || !username.trim()}>
          Guardar permiso
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">Procesando acceso…</p>}
      {!busy && !error && !page.items.length && <p>Sin concesiones directas.</p>}
      <ul aria-label="Concesiones directas">
        {page.items.map((item) => (
          <li key={item.userId}>
            <span>
              {item.username} · Directo: {permissionLabel(item.permission)}
            </span>
            <span> · Efectivo: {permissionLabel(item.effectivePermission ?? item.permission)}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setUsername(item.username);
                setPermission(item.permission);
                dialog.current?.querySelector('input')?.focus();
              }}
            >
              Modificar {item.username}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void revoke(item.userId, item.username);
              }}
            >
              Revocar {item.username}
            </button>
          </li>
        ))}
      </ul>
      {page.nextCursor && (
        <button type="button" disabled={busy} onClick={() => void more()}>
          Más concesiones
        </button>
      )}
      <button type="button" onClick={() => dialog.current?.close()}>
        Cerrar
      </button>
    </dialog>
  );
}
