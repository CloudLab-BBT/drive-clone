# Documentación Técnica: Módulo de Registro y Sesiones (O04)

**Fecha:** 2026-11-19  
**Módulo:** Identidad, Autenticación y Control de Sesiones (`apps/server/src/modules/identity/` y `apps/web/`)  
**Contratos base:** OpenAPI 3.1.0 / `@drive-clone/contracts` 1.0.0 (`O01`)

---

## 1. Endpoints Implementados (`/api/v1`)

| Método | Ruta | Acceso | CSRF / Origin | Resumen y Respuestas |
|---|---|---|---|---|
| `GET` | `/api/v1/auth/csrf` | Público | No requerido | Genera o refresca la sesión previa y devuelve `{ "csrfToken": "<token>" }`. Responde con cabecera `Cache-Control: private, no-store`. |
| `POST` | `/api/v1/auth/register` | Público | **Obligatorio** | Registra de forma transaccional el usuario y su carpeta raíz protegida. Regenera la sesión (`sessionId`). Retorna `201 Created` con `{ "user": { "id", "username", "rootId" } }`. Colisión de usuario retorna `409 Conflict` (`USERNAME_TAKEN`). Rate limited a 5 peticiones/hora/IP. |
| `POST` | `/api/v1/auth/login` | Público | **Obligatorio** | Valida credenciales con Argon2id. Regenera la sesión para evitar *Session Fixation*. Retorna `200 OK` con `{ "user": { "id", "username", "rootId" } }`. Error de credenciales devuelve `401 Unauthorized` (`UNAUTHENTICATED`) indistinguible entre usuario inexistente y contraseña incorrecta. Rate limited a 10 peticiones/minuto/IP. |
| `POST` | `/api/v1/auth/logout` | Sesión | **Obligatorio** | Destruye la sesión en PostgreSQL (`request.session.destroy()`) y limpia la cookie `drive_session` en el cliente. Retorna `204 No Content`. |
| `GET` | `/api/v1/auth/me` | Sesión | No requerido | Retorna la identidad del usuario activo y su raíz protegida: `200 OK` `{ "user": { "id", "username", "rootId" } }`. Si la sesión expiró o fue revocada retorna `401 Unauthorized` (`UNAUTHENTICATED`). Cabecera `Cache-Control: private, no-store`. |

---

## 2. Política de `username` y Normalización

1. **Restricción de formato:**
   - Longitud exacta: **3 a 32 caracteres ASCII**.
   - Debe iniciar obligatoriamente con una letra ASCII (`a-z`, `A-Z`).
   - Caracteres permitidos: letras ASCII, números (`0-9`), guion (`-`) y guion bajo (`_`).
   - Expresión regular: `^[a-zA-Z][a-zA-Z0-9_-]{2,31}$`.
2. **Normalización:**
   - Se procesa siempre con `.trim().toLowerCase()` antes de validar unicidad o persistir.
3. **Unicidad y Concurrencia:**
   - Índice único `User_username_key` en PostgreSQL.
   - Manejo transaccional de condiciones de carrera (`Promise.all` simultáneos): captura el código de error SQL `23505` (*unique_violation*) y responde con `409 Conflict` (`USERNAME_TAKEN`), garantizando consistencia sin fallos no controlados.

---

## 3. Política de Contraseñas y Hashing Argon2id

1. **Longitud:** 15 a 128 caracteres exactos sobre el string sin truncar.
2. **Frases de paso:** Se permiten espacios y caracteres UTF-8 sin imponer reglas artificiales de complejidad (no se fuerza uso de símbolos ni mayúsculas obligatorias).
3. **Parámetros Argon2id (RFC 9106):**
   - Algoritmo: **Argon2id** (`type: argon2.argon2id`).
   - Memoria mínima: **19 MiB** (`memoryCost: 19456` KiB).
   - Iteraciones en el tiempo: **2** (`timeCost: 2`).
   - Paralelismo: **1** hilo (`parallelism: 1`).
4. **Protección anti-enumeración y mitigación de timing:**
   - Ante solicitudes de login para usuarios inexistentes, se ejecuta una verificación simulada contra un hash Argon2id dummy para mantener el tiempo de respuesta constante y evitar ataques de canal lateral (*timing attacks*).

---

## 4. Arquitectura de Sesiones y Cookies

1. **Almacenamiento Persistente (`PgSessionStore`):**
   - Store personalizado compatible con `@fastify/session` v11 que persiste en la tabla relacional `Session` de PostgreSQL.
   - Implementa `get`, `set`, `compareAndSet` (control optimista de generaciones para consistencia atómica) y `destroy`.
   - Limpieza periódica de sesiones vencidas mediante `cleanExpired()`.
2. **Ciclo de vida y Expiración Dual:**
   - **Expiración absoluta máxima:** **8 horas** calculadas desde la creación de la sesión autenticada (`authCreatedAt`). Si se supera, el middleware `requireAuth` destruye la sesión y rechaza con `401`.
   - **Expiración por inactividad:** **30 minutos** máximos sin peticiones activas (`sessionIdleTimeout`), con renovación continua (`rolling: true`).
3. **Prevención de Session Fixation:**
   - Tanto `/api/v1/auth/register` como `/api/v1/auth/login` ejecutan inmediatamente `await request.session.regenerate()`, invalidando el identificador previo y emitiendo una nueva generación de cookie y sesión.
4. **Atributos de Cookie (`drive_session`):**
   - `HttpOnly: true` (inaccesible desde scripts del cliente).
   - `SameSite: 'lax'` (protección contra peticiones cruzadas no deseadas).
   - `Path: '/api/v1'`.
   - `Secure: true` en entornos HTTPS (controlado por variable de entorno `COOKIE_SECURE`).

---

## 5. Controles de Seguridad Aplicados

1. **Protección CSRF y Verificación de Origen:**
   - Integración de `@fastify/csrf-protection` vinculada a la sesión del usuario.
   - En **todas las mutaciones** (`POST`, `PUT`, `PATCH`, `DELETE`), se valida:
     - Presencia y validez del token en cabecera `x-csrf-token`.
     - Coincidencia exacta de la cabecera `Origin` contra la lista blanca configurada en `CORS_ORIGIN`.
   - Si falta o no coincide: respuesta `403 Forbidden` (`CSRF_INVALID`).
2. **Rate Limiting (`@fastify/rate-limit`):**
   - `/api/v1/auth/login`: Máximo 10 intentos por minuto por IP (`429 Too Many Requests` con cabecera `Retry-After`).
   - `/api/v1/auth/register`: Máximo 5 registros por hora por IP (`429 Too Many Requests`).
3. **Raíz Protegida del Usuario (Aislamiento O04):**
   - En el registro, se inserta transaccionalmente (`BEGIN ... COMMIT`) el usuario y su carpeta raíz (`Resource` con `isRoot = true`, `parentId = NULL`, `kind = 'FOLDER'`, `status = 'ACTIVE'`).
   - Triggers de PostgreSQL (`guard_resource_write` y `guard_root_delete`) y validaciones de servicio impiden terminantemente renombrar, eliminar o compartir la raíz del usuario (`403 Forbidden`).
4. **Logs Seguros (Cero Secretos):**
   - Logger de Fastify configurado con `redact` sobre: `req.headers.cookie`, `req.headers.authorization`, `req.headers["x-csrf-token"]` y `req.body.password`.

---

## 6. Frontend Accesible (React 19)

1. **Accesibilidad (a11y):**
   - Formularios 100% navegables por teclado (`Tab`, `Shift+Tab`, `Enter`).
   - Labels explícitamente asociados a cada control mediante `<label htmlFor="...">`.
   - Estados dinámicos de error con `aria-invalid="true"` y vinculación por `aria-describedby` a mensajes con `role="alert"`.
   - Alertas globales con `role="alert"` y `aria-live="polite"`.
2. **Flujo de Sesión y CSRF:**
   - Obtención previa de token CSRF mediante `GET /api/v1/auth/csrf`.
   - Envío de mutaciones con cabecera `x-csrf-token` y `credentials: 'include'`.
   - Refresco automático del token tras regeneración de sesión.
3. **Guard de Rutas Privadas (`ProtectedRoute`):**
   - Verifica el estado de autenticación consultando `/api/v1/auth/me`.
   - Muestra indicador de carga accesible (`role="status" aria-live="polite"`).
   - Redirige al usuario no autenticado a `/login` preservando la ruta previa en el estado.

---

## 7. Variables de Entorno Requeridas

| Variable | Descripción | Ejemplo / Placeholder |
|---|---|---|
| `DATABASE_URL` | Cadena de conexión a PostgreSQL 17 | `postgres://drive:password@postgres:5432/drive` |
| `SESSION_SECRET` | Clave secreta para firmar cookies de sesión (mínimo 32 caracteres) | `replace-with-a-random-secret-string-at-least-32-chars-long` |
| `COOKIE_SECURE` | Define si las cookies requieren HTTPS (`true` en producción, `false` en desarrollo local HTTP) | `false` |
| `CORS_ORIGIN` | Origen o lista de orígenes permitidos para CORS y validación de cabecera Origin | `http://127.0.0.1:8080` |
| `PORT` | Puerto de escucha de la API | `3000` |
| `LOG_LEVEL` | Nivel de logs | `info` |

---

## 8. Comandos de Validación y Pruebas

Todos los comandos deben ejecutarse dentro de los contenedores Docker del proyecto:

```bash
# 1. Verificación completa de tipos TypeScript
docker run --rm -v $(pwd):/app -w /app node:24.21.0-bookworm-slim npm run typecheck

# 2. Verificación de sincronización de contratos OpenAPI
docker run --rm -v $(pwd):/app -w /app node:24.21.0-bookworm-slim npm run contracts:check

# 3. Compilación del frontend React con Vite
docker run --rm -v $(pwd):/app -w /app node:24.21.0-bookworm-slim npm run build -w @drive-clone/web

# 4. Suite completa de pruebas unitarias e integradas (Backend + Frontend + Contratos)
docker run --rm --network drive-clone-dev_internal -v $(pwd):/app -w /app \
  -e DATABASE_URL=postgres://drive:change-this-local-password@postgres:5432/drive \
  -e SESSION_SECRET=dev-session-secret-replace-in-production-min32chars \
  -e CORS_ORIGIN=http://127.0.0.1:8080 \
  node:24.21.0-bookworm-slim npm test

# 5. Check global (typecheck + contracts:check + test)
docker run --rm --network drive-clone-dev_internal -v $(pwd):/app -w /app \
  -e DATABASE_URL=postgres://drive:change-this-local-password@postgres:5432/drive \
  -e SESSION_SECRET=dev-session-secret-replace-in-production-min32chars \
  -e CORS_ORIGIN=http://127.0.0.1:8080 \
  node:24.21.0-bookworm-slim npm run check
```
