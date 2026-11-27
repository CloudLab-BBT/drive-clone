# Fuentes de contratos

Todos los esquemas exportados son objetos TypeBox/JSON Schema reutilizables. Parámetro de validación: dato externo; resultado esperado del validador consumidor: aceptación o errores seguros. `Static<typeof Schema>` deriva el tipo, sin duplicarlo. Ningún esquema comprueba DB, permisos, bytes reales o normalización: véase `docs/politicas.md`.

| Archivo            | Exportaciones principales, datos y conexiones                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `common.ts`        | Uuid/Timestamp/Name/Username/Permission, errores y paginación; base compartida. ErrorResponse limita el cuerpo público; ResourceParams es id UUID.                                                                                                                              |
| `identity.ts`      | Credentials(username,password), User(id,username,rootId), AuthResponse y CsrfResponse; sin hash ni sesión serializada.                                                                                                                                                          |
| `resources.ts`     | Resource/ResourcePage, CreateFolder(parentId,name), RenameResource(name); ShareInput(username,permission), SharePage y RevokeResponse(permiso restante); DeleteQuery(confirmación), DeletionResponse(estado/impacto/progreso). Usa primitivas comunes.                          |
| `uploads.ts`       | CreateUpload(parentId,name,size), Upload y ActiveUploads; uploadStates enum público; UploadMessage/DeleteMessage/WorkerMessage v1 estrictos con id, sin binarios.                                                                                                               |
| `operations.ts`    | Operation describe method/path/body/params/query/status/response/access/csrf/errors/binary; operations enumera 23 operaciones y vincula esquemas sin implementar handlers.                                                                                                      |
| `openapi.ts`       | createOpenApi(): sin parámetros, devuelve documento OpenAPI 3.1 construido desde operations. parameters(operation) deriva path/query y cabecera CSRF; specification(operation) arma entrada, salida, errores y seguridad. Solo genera metadatos.                                |
| `authorization.ts` | ResourceAction, AuthorizationInput(actorId,resourceId,action) y AuthorizationDecision(visible,allowed,effectivePermission); ResourceAuthorization.evaluate devuelve Promise de decisión. Es un puerto para O05 sin implementación ni acceso DB; denegación no lanza error HTTP. |
| `index.ts`         | Entrada pública; reexporta esquemas, operaciones y tipo Static.                                                                                                                                                                                                                 |

Para Fastify, reutilizar body/params/query/response por operación; el adaptador HTTP convertirá `{id}` de OpenAPI a `:id`, y registrará validación/serialización y hooks reales. No interpretar los metadatos de seguridad como autorización implementada. Conversión de query HTTP a boolean/integer debe configurarse y probarse en O02/O04; el JSON Schema representa el dato ya coercionado, sin coercionar cuerpos JSON arbitrarios.

El registro HTTP se compone en `operations.ts`. `operation.ts` define el tipo
de operación y sus errores comunes. `resource-operations.ts` declara carpetas,
recursos, compartición y consulta de borrado. `transfer-operations.ts` declara
cargas y descarga. `EditResourceResponse` admite la respuesta de renombrado sin
padre privado cuando el solicitante tiene EDIT.
