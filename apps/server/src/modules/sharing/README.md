# Compartición de recursos

- `routes.ts` registra la consulta, el alta o cambio y la revocación de
  concesiones. Aplica los contratos HTTP, sesión, origen y CSRF. Devuelve las
  respuestas de la API sin almacenamiento en caché.
- `store.ts` implementa `ShareStore.list(actorId, resourceId, page)`,
  `upsert(actorId, resourceId, username, permission)` y
  `revoke(actorId, resourceId, userId)`. Devuelve una página de concesiones,
  la concesión guardada o el permiso restante, respectivamente. Usa PostgreSQL
  y la política común de autorización. Las mutaciones se serializan mediante
  el bloqueo de la fila del propietario y reevalúan el recurso en la transacción.
- `sharing.integration.test.ts` cubre propietario, receptor y tercero,
  duplicados, normalización, paginación, herencia, privacidad y exclusión de
  recursos en eliminación.
- `shared-file.integration.test.ts` comprueba la descarga con READ y EDIT en
  LocalStack y el rechazo tras revocar. Se activa con `RUN_FILES_INTEGRATION=true`.
