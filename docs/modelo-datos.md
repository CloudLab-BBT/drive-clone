# Modelo de datos v1

Especificación implementable; no es una migración ejecutada. UUID generado por aplicación o PostgreSQL, timestamptz UTC y bigint para bytes; respuestas JSON usan enteros seguros dentro de las cuotas. Nunca serializar entidades completas automáticamente.

## Entidades y campos

| Entidad | Campos y nulabilidad | Relaciones y responsabilidad |
| --- | --- | --- |
| User | id PK; username varchar(32) UNIQUE NOT NULL; passwordHash text NOT NULL; reservedBytes bigint NOT NULL DEFAULT 0; usedBytes bigint NOT NULL DEFAULT 0; createdAt NOT NULL | Usuario normalizado; contadores bajo bloqueo de fila. Raíz obtenida desde Resource. |
| Session | id text PK; userId UUID nullable; data jsonb NOT NULL; createdAt, lastSeenAt, expiresAt NOT NULL | Contrato de store de @fastify/session: get/set/destroy y TTL; sesión previa sin usuario. Adaptador O04, sin cifrado propio. |
| Resource | id PK; ownerId FK User NOT NULL; parentId UUID nullable; kind FILE/FOLDER NOT NULL; name varchar(120), nameKey text NOT NULL; isRoot boolean NOT NULL DEFAULT false; status RESERVED/ACTIVE/UNAVAILABLE/DELETING NOT NULL; size bigint, mimeType text, sha256 char(64), objectKey text nullable; createdAt, updatedAt NOT NULL | Árbol único y propiedad. Metadatos de archivo se publican juntos al completar. raíz: parentId NULL, FOLDER y ACTIVE. |
| Share | resourceId FK Resource; userId FK User; permission READ/EDIT NOT NULL; createdAt, updatedAt NOT NULL; PK(resourceId,userId) | Solo concesiones directas, eliminadas/invalidadas al borrar; nunca compartir raíz ni consigo mismo. |
| Upload | id PK; userId FK User; resourceId FK Resource UNIQUE; status según estados; expectedSize bigint NOT NULL; receivedBytes bigint NOT NULL DEFAULT 0; tempKey text nullable; sha256 char(64) nullable; attemptId UUID nullable; attemptCount int NOT NULL DEFAULT 0; leaseUntil, nextAttemptAt nullable; cancelRequestedAt nullable; errorCode nullable; cleanupPending boolean NOT NULL DEFAULT false; createdAt, updatedAt NOT NULL | Reserva individual; temporal interno no derivado del nombre. Historial terminal conservado aunque se retire Resource (véase relación histórica). |
| Deletion | id PK; resourceId UUID NOT NULL histórico; ownerId y requestedById FK User; status PENDING/PROCESSING/COMPLETED/FAILED; affectedResources, processedResources int NOT NULL; attemptCount int NOT NULL DEFAULT 0; attemptId UUID, leaseUntil, nextAttemptAt nullable; errorCode nullable; createdAt, updatedAt NOT NULL | Una operación durable por subárbol; snapshot del objetivo, sin FK restrictiva al recurso que se eliminará. |
| Outbox | id PK UUID; entityId UUID NOT NULL; type UPLOAD/DELETE; version int NOT NULL = 1; payload jsonb NOT NULL; publishAttempts int DEFAULT 0; availableAt NOT NULL; publishedAt, attemptId, leaseUntil, errorCode nullable; createdAt NOT NULL | Despacho durable; payload cumple esquema versionado y no lleva binario ni ruta. |

Upload.resourceId identifica históricamente al recurso. Mientras existe, su relación y dueño deben validarse en creación/transacción; no usar FK restrictiva permanente que impida finalizar el borrado. Alternativa implementable acordada: FK nullable `resourceRefId` a Resource con ON DELETE SET NULL y `resourceId` histórico inmutable; UNIQUE(resourceRefId), CHECK(resourceRefId IS NULL OR resourceRefId = resourceId). La tabla Upload conserva ambos campos. Deletion mantiene progreso durable sin depender de metadatos borrados.

Para reconciliación, Upload necesita inventario durable de intentos y objetos: `UploadAttempt(id UUID PK, uploadId FK Upload NOT NULL, objectKey text UNIQUE NOT NULL, status WRITING/PUBLISHED/DISCARDED/CLEANED NOT NULL, createdAt, updatedAt NOT NULL)`. Registrar antes de escribir S3; no enviar estas claves al cliente. La fila publicada se conserva hasta borrado; las descartadas se reintentan hasta confirmar ausencia del objeto. Deletion consulta este inventario antes de liberar cuota.

## Restricciones e índices

- User: CHECK username = lower(username) y regex `^[a-z][a-z0-9_-]{2,31}$`; bytes no negativos; usedBytes + reservedBytes <= cuota configurada aplicada transaccionalmente (no CHECK con configuración externa).
- Resource: UNIQUE(id, ownerId); FK(parentId,ownerId) → Resource(id,ownerId), sin CASCADE. Índice `(parentId,createdAt,id)` para cursor; `(ownerId,status)` para búsquedas; índice parcial único `(ownerId)` WHERE isRoot.
- Raíz: CHECK ((isRoot AND parentId IS NULL AND kind='FOLDER' AND status='ACTIVE') OR (NOT isRoot AND parentId IS NOT NULL)). Borrado/renombrado/compartición de raíz rechazados por caso de uso y protección de trigger en migración.
- UNIQUE(parentId,nameKey) para recursos reservados, activos, no disponibles y pendientes de borrado. El nombre se libera al retirar metadatos, evitando reutilización antes de limpieza. CHECK char_length(name) BETWEEN 1 AND 120; nombre/nameKey calculados por normalizador común y validados en escritura.
- Carpetas: size/mimeType/sha256/objectKey NULL. Archivos RESERVED pueden carecer de metadatos; ACTIVE exige los cuatro NOT NULL; size >= 0, sha256 hexadecimal, objectKey único si no NULL. UNAVAILABLE retiene metadatos para diagnóstico; DELETING puede proceder de reserva.
- Padre FOLDER activo, profundidad <=10, propiedad coincidente y no ciclo: validar bajo bloqueo de propietario y trigger defensivo; FK compuesta solo garantiza propiedad/existencia, no tipo ni profundidad. parentId/ownerId/isRoot inmutables después de crear.
- Share: índices `(userId,createdAt,resourceId)` para entradas compartidas y `(resourceId,createdAt,userId)` para concesiones de un recurso; permiso enum; PK impide duplicados. Validez de raíz y auto-concesión comprobada por caso de uso/trigger.
- Upload: CHECK bytes >=0 y receivedBytes <= expectedSize; expectedSize <= máximo publicado; intentos 0..3; leaseUntil y attemptId ambos presentes en PROCESSING; índice `(userId,status,createdAt,id)`, `(status,leaseUntil)` y `(status,nextAttemptAt)`.
- Deletion: progreso 0..affectedResources; índice `(ownerId,createdAt,id)` y `(status,leaseUntil)`; asociar todos los recursos DELETING al id de Deletion mediante `Resource.deletionId` nullable FK, que será NOT NULL en DELETING. No superponer borrados.
- Outbox: UNIQUE(type,entityId,version) para una intención de despacho; índice parcial `(availableAt,createdAt,id)` WHERE publishedAt IS NULL. Reintento de negocio reactiva la misma fila bajo bloqueo, sin crear otra intención contradictoria. Proteger finalización mediante attemptId de publicación.
- Session: índice expiresAt y userId; borrado explícito al revocar/caducar. Índices de claves foráneas y consultas deben comprobarse en O02/O15.

## Fronteras transaccionales

1. Registro: User + raíz + sesión autenticada coherentes; si store impide transacción conjunta, no responder éxito autenticado antes de guardar sesión; fallo seguro y recuperación documentados en O04.
2. Crear carpeta/reservar carga: bloquear User (orden global por ownerId), comprobar ancestros activos, permiso, profundidad, nombre, cuota y número de trabajos; insertar Resource/Upload y reservar bytes en la misma transacción. Todos los escritores del árbol usan el mismo bloqueo de fila User.
3. Recibir: adquisición CREATED → RECEIVING con comparación de estado; streaming fuera de transacción. Completar recepción: comprobar tamaño, hash, archivo temporal completo y padre activo; QUEUED + outbox atómicos. No publicar recurso aún.
4. Finalizar carga: bloqueo de propietario + Upload, comprobar lease/attemptId y ausencia de cancelación, padre/ancestros activos; publicar objectKey y Resource ACTIVE, Upload COMPLETED y traslado de reserva a usados en una transacción. No duplicar contabilización.
5. Cancelar frente a finalizar: mismo orden de bloqueos; actualización condicionada al estado. COMPLETED gana → 409; CANCEL_REQUESTED gana → imposible publicar. La pérdida de lease impide confirmar.
6. Compartir/revocar/renombrar: bloqueo de árbol del propietario; reevaluar autorización y nombre/estado dentro de la transacción para no usar permisos obsoletos.
7. Borrar: bajo bloqueo, reevaluar EDIT/propiedad, excluir raíz y borrados superpuestos; calcular snapshot/impacto, marcar subárbol DELETING, retirar Share, cancelar Upload y crear Deletion/outbox. Commit antes de S3. Borrado físico idempotente fuera de transacción y metadatos retirados de hojas a raíz; cuota liberada una vez al confirmar limpieza. No usar cascada SQL como semántica S3.

Bloqueos multi-fila siempre en orden estable (propietario → recursos ordenados → trabajos); errores de serialización/deadlock con reintento acotado y sin efectos de red dentro de la transacción. Las pruebas de concurrencia pertenecen a O06/O10/O12/O13, no están acreditadas por este modelo.
