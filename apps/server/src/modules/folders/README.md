# Carpetas

- `routes.ts` registra `POST /api/v1/folders` con sesión, origen y CSRF. Recibe
  `{ parentId, name }` y devuelve `201` con `{ resource }` según el contrato compartido.
- `store.ts` implementa `FolderStore.create(ownerId, parentId, name, nameKey)`.
  Crea una carpeta activa en PostgreSQL bajo el bloqueo de la fila del propietario.
  Devuelve los metadatos persistidos o un conflicto de nombre entre hermanos.
- `folders.integration.test.ts` comprueba permisos, profundidad, unicidad y
  exclusión de ancestros en eliminación frente a la API y PostgreSQL.
- `folder-upload.integration.test.ts` valida carga, listado y descarga en una
  subcarpeta con el trabajador y LocalStack. Usa `RUN_UPLOAD_INTEGRATION=true`.
- `folder-session.fixture.ts` recibe la instancia Fastify y devuelve una sesión
  sintética, su raíz y funciones para invocar creación, listado y reserva.

El listado reutiliza `GET /api/v1/folders/:id/children` del módulo de archivos.

`folder-deletion.fixture.ts` prepara un estado de eliminación válido en la
transacción de prueba a partir del propietario y del recurso elegidos.
