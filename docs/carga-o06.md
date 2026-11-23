# Primera carga por cola (O06)

## Secuencia

1. `POST /api/v1/uploads` exige sesión y CSRF. Bajo el bloqueo del propietario, evalúa `CREATE_CHILD` de O05 sobre la carpeta de destino en la misma transacción; después reserva la entrada y la cuota.
2. `PUT /api/v1/uploads/{id}/content` recibe `multipart/form-data` con exactamente un campo `file`. Escribe por streaming un archivo interno `.part` con nombre aleatorio generado por el servidor, calcula SHA-256 y comprueba tamaño y formato. Al terminar lo renombra a `.ready`. El nombre y MIME enviados por el cliente no deciden la ruta ni el formato.
3. La API registra `QUEUED` y el Outbox en la misma transacción. El mensaje SQS es `{ "version": 1, "type": "UPLOAD", "id": "uuid" }`.
4. El trabajador publica Outbox, consume SQS y reconcilia leases en ciclos separados. Cada intento usa `uploads/{userId}/{uploadId}/{attemptId}` como clave S3. Antes de publicar, bajo el bloqueo del propietario y en la misma transacción, reevalúa `CREATE_CHILD` de O05; mantiene las comprobaciones del intento vigente y del estado `RESERVED`. Un ancestro en eliminación impide la publicación.
5. La interfaz consulta `GET /api/v1/uploads?active=true` como máximo una vez por segundo, sin consultas solapadas. Cuando sale del listado activo consulta una vez el estado final. La respuesta tardía del PUT no revierte `COMPLETED` ni `FAILED` a `QUEUED`. El porcentaje del envío HTTP no equivale a disponibilidad.

## Endpoints

`POST /uploads` recibe `parentId`, `name` y `size`; `PUT /uploads/{id}/content` recibe un único campo multipart `file`; `GET /uploads/{id}` y `GET /uploads?active=true` devuelven solo trabajos del usuario autenticado. Todos usan prefijo `/api/v1`. Los errores públicos siguen `docs/api.md`: cuerpo o campos inválidos, `INVALID_INPUT` (400); exceso de bytes, `PAYLOAD_TOO_LARGE` (413); formato o tipo de contenido incompatibles, `UNSUPPORTED_FORMAT` (415); límite de cargas, `RATE_LIMITED` (429) con `Retry-After` en segundos.

## Estados y límites

El recorrido de O06 usa `CREATED → RECEIVING → QUEUED → PROCESSING → COMPLETED`. Una recepción inválida pasa a `FAILED`. El trabajador reintenta errores de proceso hasta tres intentos. Cada archivo admite 100 MiB; se reservan hasta diez cargas no terminales y una cuota total de 1 GiB por usuario.

El temporal está en `TEMP_DIR`, volumen compartido por API y trabajador en un único host. Los nombres visibles no forman rutas temporales ni claves S3. La cancelación completa corresponde a O10, y la recuperación avanzada, barrido de residuos y operación tras pérdida de mensajes/DLQ corresponden a O13. Este recorrido no implementa descarga desde la interfaz.

## Validación

Los comandos y resultados ejecutados, junto con las pruebas pendientes, están en `docs/validacion-o06.md`.

La prueba de integración de este recorrido usa un proyecto Compose de pruebas, con volúmenes separados y el trabajador activo:

```sh
docker compose -p drive-clone-o06-test up -d worker
docker compose -p drive-clone-o06-test run --rm -e RUN_UPLOAD_INTEGRATION=true api npx vitest run apps/server/src/modules/uploads/upload.integration.test.ts
```
