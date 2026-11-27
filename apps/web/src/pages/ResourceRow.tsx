import { ShareAction } from './ShareAction.tsx';
import { ResourceEditActions } from './ResourceEditActions.tsx';
import type { Deletion } from './DeletionNotice.tsx';
import type { Resource } from './useFilePage.ts';

export function ResourceRow({
  item,
  ownList,
  open,
  save,
  refresh,
  track,
}: {
  item: Resource;
  ownList?: boolean;
  open: () => void;
  save: () => void;
  refresh: () => void;
  track: (job: Deletion, name: string) => void;
}) {
  return (
    <li>
      <span>
        {item.kind === 'FOLDER' ? '📁' : '📄'} {item.name}
      </span>
      {item.kind === 'FILE' ? (
        <>
          <span>{item.size?.toLocaleString('es-CL')} bytes · Disponible</span>
          <button type="button" onClick={save}>
            Descargar {item.name}
          </button>
        </>
      ) : (
        <button type="button" onClick={open}>
          Abrir {item.name}
        </button>
      )}
      {ownList && item.effectivePermission === 'OWNER' && <ShareAction resource={item} />}
      <ResourceEditActions resource={item} onRenamed={refresh} onDeleted={track} />
    </li>
  );
}
