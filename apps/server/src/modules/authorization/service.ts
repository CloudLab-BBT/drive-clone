import type { ResourceAuthorization } from '@drive-clone/contracts';
import type { PoolClient } from 'pg';
import { accessQuery } from './access-query.ts';
import { decide, type Input, type VisibleResource } from './policy.ts';

interface AccessRow extends VisibleResource {
  anchor: boolean;
}

export type AccessDatabase = Pick<PoolClient, 'query'>;
export interface PageBoundary {
  createdAt: string;
  id: string;
}
export interface AccessPage {
  limit?: number;
  after?: PageBoundary;
}
export interface VisiblePage {
  items: VisibleResource[];
  next: PageBoundary | null;
}

export class AuthorizationService implements ResourceAuthorization {
  readonly #db: AccessDatabase;

  constructor(db: AccessDatabase) {
    this.#db = db;
  }

  async evaluate({ actorId, resourceId, action }: Input) {
    const [resource] = await this.#find(actorId, 'one', resourceId, 1);
    return decide(resource, action);
  }

  async listChildren(actorId: string, folderId: string, page: AccessPage = {}) {
    const limit = pageLimit(page);
    // La primera fila acredita acceso a la carpeta en la misma sentencia.
    const [parent, ...rows] = await this.#find(actorId, 'children', folderId, limit + 2, page.after);
    return parent?.anchor ? visiblePage(rows, limit) : null;
  }

  async listShared(actorId: string, page: AccessPage = {}) {
    const limit = pageLimit(page);
    const rows = await this.#find(actorId, 'shared', null, limit + 1, page.after);
    return visiblePage(rows, limit);
  }

  async #find(
    actorId: string, mode: 'one' | 'children' | 'shared', target: string | null,
    limit: number, after?: PageBoundary,
  ): Promise<AccessRow[]> {
    const { rows } = await this.#db.query<AccessRow>(accessQuery, [
      actorId, mode, target, after?.createdAt ?? null, after?.id ?? null, limit,
    ]);
    return rows;
  }
}

function pageLimit(page: AccessPage): number {
  const limit = page.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('El tamaño de página debe estar entre 1 y 100');
  }
  return limit;
}

function visiblePage(rows: AccessRow[], limit: number): VisiblePage {
  const items = rows.slice(0, limit).map(({ id, kind, isRoot, effectivePermission, cursorCreatedAt }) => ({
    id, kind, isRoot, effectivePermission, cursorCreatedAt,
  }));
  const last = items.at(-1);
  const next = rows.length > limit && last ? { createdAt: last.cursorCreatedAt, id: last.id } : null;
  return { items, next };
}
