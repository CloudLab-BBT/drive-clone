# Primera carga por cola (O06)

## Secuencia

1. `POST /api/v1/uploads` exige sesión, CSRF y carpeta propia activa. Normaliza el nombre, reserva la entrada y la cuota en PostgreSQL y devuelve el ID de carga.
2. `PUT /api/v1/uploads/{id}/content` recibe un único cuerpo `application/octet-stream`. Escribe por streaming un archivo interno `.part`, calcula SHA-256 y comprueba tamaño y formato. Al terminar lo renombra a `.ready`.
3. La API registra `QUEUED` y el Outbox en la misma transacción. El mensaje SQS es `{ "version": 1, "type": "UPLOAD", "id": "uuid" }`.
4. El trabajador publica Outbox, consume SQS y reconcilia leases en ciclos separados. Cada intento usa `uploads/{userId}/{uploadId}/{attemptId}` como clave S3. Solo el intento vigente puede confirmar `COMPLETED` y hacer visible el recurso.
5. La interfaz consulta `GET /api/v1/uploads?active=true` como máximo una vez por segundo mientras hay carga activa. Cuando sale del listado activo consulta una vez el estado final. El porcentaje del envío HTTP no equivale a disponibilidad.

## Endpoints

`POST /uploads` recibe `parentId`, `name` y `size`; `PUT /uploads/{id}/content` recibe los bytes; `GET /uploads/{id}` y `GET /uploads?active=true` devuelven solo trabajos del usuario autenticado. Todos usan prefijo `/api/v1`.

## Estados y límites

El recorrido de O06 usa `CREATED → RECEIVING → QUEUED → PROCESSING → COMPLETED`. Una recepción inválida pasa a `FAILED`. El trabajador reintenta errores de proceso hasta tres intentos. Cada archivo admite 100 MiB; se reservan hasta diez cargas no terminales y una cuota total de 1 GiB por usuario.

El temporal está en `TEMP_DIR`, volumen compartido por API y trabajador en un único host. Los nombres visibles no forman rutas temporales ni claves S3. La cancelación completa corresponde a O10, y la recuperación avanzada, barrido de residuos y operación tras pérdida de mensajes/DLQ corresponden a O13. Este recorrido no implementa descarga desde la interfaz.

## Validación pendiente

Ejecutar con Node 24.12+, PostgreSQL y LocalStack Pro configurado fuera del repositorio: pruebas de base, cola, trabajador y lectura de objeto S3 para comparar SHA-256 y bytes; inyección de fallos SQS/S3; reentrega y reinicio; aislamiento entre usuarios y estados de interfaz.

La prueba de integración de este recorrido usa un proyecto Compose de pruebas, con volúmenes separados y el trabajador activo:

```sh
docker compose -p drive-clone-o06-test up -d worker
docker compose -p drive-clone-o06-test run --rm -e RUN_UPLOAD_INTEGRATION=true api npx vitest run apps/server/src/modules/uploads/upload.integration.test.ts
```
