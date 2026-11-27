import { useState, type FormEvent } from 'react';
import { apiFetch } from '../api/client.ts';

export function FolderForm({ parentId, onCreated }: { parentId: string; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    setNotice('');
    try {
      await apiFetch('/api/v1/folders', {
        method: 'POST',
        body: JSON.stringify({ parentId, name: name.normalize('NFC').trim() }),
      });
      setName('');
      setNotice('Carpeta creada');
      onCreated();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="folder-create"
      aria-label="Nueva carpeta"
    >
      <label>
        Nombre de la carpeta
        <input required value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <button className="btn btn-secondary" type="submit" disabled={pending}>
        {pending ? 'Creando carpeta…' : 'Crear carpeta'}
      </button>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
