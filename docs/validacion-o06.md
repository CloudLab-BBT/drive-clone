# Validación de O06

Fecha: 2026-11-23. Entorno aislado `drive-clone-o06-test` con PostgreSQL 17, LocalStack Student, API, web y trabajador en volúmenes separados de desarrollo. Node del contenedor: 24.21.0. Se añadió `SESSION_SECRET` aleatorio al `.env` local ignorado por Git para iniciar Compose; no se registran secretos aquí.

## Comandos y resultados

| Comando | Resultado |
| --- | --- |
| `docker compose -p drive-clone-o06-test up -d --build worker web` | Servicios iniciados; PostgreSQL, LocalStack, API y trabajador saludables. |
| `docker compose -p drive-clone-o06-test run --rm -e RUN_UPLOAD_INTEGRATION=true -e LOG_LEVEL=silent api npx vitest run apps/server/src/modules/uploads/upload.integration.test.ts --maxWorkers=1 --fileParallelism=false --testTimeout=45000` | 3/3 aprobadas: recepción multipart, errores O01, límite 429 con `Retry-After`, aislamiento, Outbox→SQS→S3, bytes y SHA-256, reentrega. |
| `docker compose -p drive-clone-o06-test stop worker` y `docker compose -p drive-clone-o06-test run --rm -e RUN_UPLOAD_FAILURES=true -e LOG_LEVEL=silent api npx vitest run apps/server/src/modules/uploads/upload-failures.integration.test.ts --maxWorkers=1 --fileParallelism=false --testTimeout=45000` | 3/3 aprobadas: fallo y reintento de SQS/S3, ancestro en eliminación impide publicar, renovación de lease solo para el intento activo. Trabajador detenido para evitar competencia por el mismo mensaje. |
| `docker compose -p drive-clone-o06-test run --rm -e RUN_UPLOAD_FAILURES=true -e LOG_LEVEL=silent api npx vitest run apps/server/src/modules/uploads/lease.integration.test.ts --maxWorkers=1 --fileParallelism=false --testTimeout=45000` | 1/1 aprobada: con la respuesta S3 retenida, el temporizador renovó el lease del intento activo e invocó el callback de visibilidad; al liberar la respuesta, la publicación completó. |
| `docker compose -p drive-clone-o06-test run --rm -e LOG_LEVEL=silent api npm run check` | Tipos, OpenAPI y suite general aprobados: 78 pruebas; 7 integraciones O06 excluidas por defecto y ejecutadas por separado arriba. |
| `npm run build -w @drive-clone/web` (durante construcción de imagen) | Compilación de producción aprobada. |
| `npx vitest run apps/web/src/pages/useUpload.test.tsx` | 3/3 aprobadas, incluida la regresión con consulta pendiente y cambio de estado: la siguiente consulta espera y respeta el intervalo de un segundo. |

## Navegador a S3

Con Playwright CLI se abrió `http://127.0.0.1:8080`, se registró una cuenta de prueba, se seleccionó `o06-browser-2311.pdf` y se pulsó **Subir**. La interfaz llegó a **Archivo disponible**. El SHA-256 local, el de `Resource.sha256` en PostgreSQL y el objeto descargado desde S3 con `awslocal s3 cp` coincidieron: `ae28f3f4b95558f5b955b5a376c315c020f1cfe0d99a7371744eed51b0661fad`. `Upload.status` quedó `COMPLETED`.

## Ciclos independientes

`consumeQueue()` solicita mensajes con `WaitTimeSeconds: 20`; `worker.ts` ejecuta `publishOutbox`, `consumeQueue` y `reconcileExpired` en bucles separados. Con el trabajador activo se insertó un evento Outbox de prueba durante el consumo: `publishedAt` se registró a los 0,277 s de `createdAt` en una ejecución y el sondeo externo confirmó publicación en 1,9 s en otra, antes de los 20 s del long polling. Una prueba de lease comprobó que un intento `PROCESSING` vigente extiende `leaseUntil` a más de 50 s y que otro `attemptId` no puede renovarlo. Otra mantuvo retenida la respuesta S3, adelantó el temporizador 20 s y comprobó la renovación del lease y la invocación del callback que en `consumeQueue()` renueva la visibilidad SQS.

## Límites de la evidencia

La renovación se probó con una respuesta S3 retenida y reloj controlado; no se midió una transferencia S3 real de más de 20 s. Tampoco se probaron reinicio del trabajador, agotamiento hasta DLQ, cancelación completa ni recuperación avanzada; estas últimas capacidades corresponden a O10/O13. La descarga desde la interfaz corresponde a O07. `npm ci` informó cinco avisos altos de dependencias; no se cambiaron versiones fuera de O06.
