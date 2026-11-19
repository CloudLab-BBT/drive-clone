import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { validateUsername } from './username.ts';
import { hashPassword, validatePassword, verifyPassword } from './password.ts';
import { ForbiddenError, InvalidCredentialsError, InvalidInputError, UsernameTakenError } from './errors.ts';

export interface UserSummary {
  id: string;
  username: string;
  rootId: string;
}

// Hash ficticio para timing constante en usuarios inexistentes
const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$6u/mYxJm9a2W0N/0Q9p4Q';

export class IdentityService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Registro atómico transaccional de Usuario y carpeta Raíz protegida.
   */
  async register(input: { username: string; password: string }): Promise<UserSummary> {
    const userVal = validateUsername(input.username);
    if (!userVal.valid || !userVal.normalized) {
      throw new InvalidInputError(userVal.error, { username: [userVal.error ?? 'Inválido'] });
    }

    const passVal = validatePassword(input.password);
    if (!passVal.valid) {
      throw new InvalidInputError(passVal.error, { password: [passVal.error ?? 'Inválido'] });
    }

    const passwordHash = await hashPassword(input.password);
    const userId = randomUUID();
    const rootId = randomUUID();
    const username = userVal.normalized;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Insertar usuario
      await client.query(
        `INSERT INTO "User" (id, username, "passwordHash", "reservedBytes", "usedBytes", "createdAt")
         VALUES ($1, $2, $3, 0, 0, NOW())`,
        [userId, username, passwordHash],
      );

      // 2. Insertar carpeta raíz protegida
      await client.query(
        `INSERT INTO "Resource" (id, "ownerId", "parentId", kind, name, "nameKey", "isRoot", status, "createdAt", "updatedAt")
         VALUES ($1, $2, NULL, 'FOLDER', 'root', 'root', true, 'ACTIVE', NOW(), NOW())`,
        [rootId, userId],
      );

      await client.query('COMMIT');
      return { id: userId, username, rootId };
    } catch (error: any) {
      await client.query('ROLLBACK');
      // Código PostgreSQL 23505: unique_violation (username duplicado)
      if (error?.code === '23505') {
        throw new UsernameTakenError('El nombre de usuario ya está en uso');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Autenticación con verificación de contraseña Argon2id y mitigación de enumeración.
   */
  async login(input: { username: string; password: string }): Promise<UserSummary> {
    if (typeof input.username !== 'string' || typeof input.password !== 'string') {
      throw new InvalidCredentialsError('Credenciales inválidas');
    }

    const userVal = validateUsername(input.username);
    const username = userVal.normalized ?? input.username.trim().toLowerCase();

    const result = await this.pool.query(
      `SELECT u.id, u.username, u."passwordHash", r.id AS "rootId"
       FROM "User" u
       LEFT JOIN "Resource" r ON r."ownerId" = u.id AND r."isRoot" = true
       WHERE u.username = $1`,
      [username],
    );

    if (result.rows.length === 0) {
      // Mitigación de timing attack: ejecutar verificación contra hash ficticio
      await verifyPassword(DUMMY_HASH, input.password);
      throw new InvalidCredentialsError('Credenciales inválidas');
    }

    const user = result.rows[0];
    const passwordMatch = await verifyPassword(user.passwordHash, input.password);
    if (!passwordMatch) {
      throw new InvalidCredentialsError('Credenciales inválidas');
    }

    return {
      id: user.id,
      username: user.username,
      rootId: user.rootId,
    };
  }

  /**
   * Obtener datos del usuario autenticado actual y su raíz.
   */
  async getUser(userId: string): Promise<UserSummary | null> {
    const result = await this.pool.query(
      `SELECT u.id, u.username, r.id AS "rootId"
       FROM "User" u
       LEFT JOIN "Resource" r ON r."ownerId" = u.id AND r."isRoot" = true
       WHERE u.id = $1`,
      [userId],
    );
    if (result.rows.length === 0) return null;
    const user = result.rows[0];
    return {
      id: user.id,
      username: user.username,
      rootId: user.rootId,
    };
  }

  /**
   * Verificar que un recurso no sea la raíz protegida ante operaciones prohibidas.
   */
  assertNotRoot(resource: { isRoot?: boolean }): void {
    if (resource.isRoot) {
      throw new ForbiddenError('La raíz está protegida y no puede modificarse, compartirse ni eliminarse');
    }
  }
}
