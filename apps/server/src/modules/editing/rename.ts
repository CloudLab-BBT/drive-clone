import { extname } from 'node:path';
import { publicResource, type FileRow } from '../files/store.ts';
import { AppError, InvalidInputError } from '../identity/errors.ts';
import { normalizeResourceName } from '../resources/name.ts';
import { editAccess, lockOwner, transaction, unavailable } from './transaction.ts';

export async function renameResource(actorId: string, id: string, value: string) {
  const { name, nameKey } = normalizeResourceName(value);
  try {
    return await transaction(async (db) => {
      const {
        rows: [resource],
      } = await db.query<FileRow>('SELECT * FROM "Resource" WHERE id = $1', [id]);
      if (!resource) throw unavailable();
      await lockOwner(db, resource.ownerId);
      const permission = await editAccess(db, actorId, id, 'RENAME');
      if (
        resource.kind === 'FILE' &&
        extname(name).toLowerCase() !== extname(resource.name).toLowerCase()
      )
        throw new InvalidInputError('El archivo debe conservar su extensión');
      const {
        rows: [updated],
      } = await db.query<FileRow>(
        'UPDATE "Resource" SET name = $2,"nameKey" = $3,"updatedAt" = now() WHERE id = $1 RETURNING *',
        [id, name, nameKey],
      );
      const result = publicResource(updated, permission);
      if (permission === 'OWNER') return result;
      const { parentId: _privateParentId, ...shared } = result;
      return shared;
    });
  } catch (error) {
    if ((error as { constraint?: string }).constraint === 'Resource_parentId_nameKey_key')
      throw new AppError('NAME_CONFLICT', 'Nombre ya utilizado', 409);
    throw error;
  }
}
