import { useRef, useState } from 'react';
import { EditDialog } from './EditDialog.tsx';
import type { Deletion } from './DeletionNotice.tsx';
import type { Resource } from './useFilePage.ts';

export type Mode = 'rename' | 'delete';
export interface EditActionProps {
  resource: Resource;
  onRenamed: () => void;
  onDeleted: (deletion: Deletion, name: string) => void;
}

export function ResourceEditActions({ resource, onRenamed, onDeleted }: EditActionProps) {
  const [mode, setMode] = useState<Mode | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  if (resource.effectivePermission === 'READ') return null;
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          trigger.current = event.currentTarget;
          setMode('rename');
        }}
      >
        Renombrar {resource.name}
      </button>
      <button
        type="button"
        onClick={(event) => {
          trigger.current = event.currentTarget;
          setMode('delete');
        }}
      >
        Eliminar {resource.name}
      </button>
      {mode && (
        <EditDialog
          resource={resource}
          mode={mode}
          onRenamed={onRenamed}
          onDeleted={onDeleted}
          onClose={() => {
            setMode(null);
            trigger.current?.focus();
          }}
        />
      )}
    </>
  );
}
