# Validación de O13

## Entorno y versión

Rama `feat/o13-recuperacion-cargas`, basada en `origin/main` en
`a64f4340ad0cfab77fadbdf934175ae175338075`. Trabajo sin commit: las
pruebas se ejecutaron sobre los archivos de esta rama. Docker Compose se levantó
con el proyecto aislado `drive-clone-o13` (PostgreSQL, LocalStack, inicialización
de temporales, migraciones y bootstrap). Se reconstruyó la imagen `api` antes de
la ejecución final. No se arrancó el trabajador durante las suites de fallos para
evitar consumidores ajenos a cada caso.

## Pruebas específicas

```sh
docker compose -p drive-clone-o13 build api
docker compose -p drive-clone-o13 run --rm -e RUN_O13_INTEGRATION=true api npx vitest run \
  src/modules/uploads/recovery.integration.test.ts \
  src/modules/uploads/recovery-race.integration.test.ts \
  src/modules/uploads/recovery-queue.integration.test.ts \
  src/modules/uploads/recovery-dlq.integration.test.ts \
  src/modules/uploads/recovery-loops.integration.test.ts \
  src/modules/uploads/recovery-cleanup.integration.test.ts \
  src/modules/uploads/recovery-object.integration.test.ts \
  src/modules/uploads/recovery-history.integration.test.ts \
  src/modules/uploads/recovery-sql.integration.test.ts --silent
```

Resultado final: **9 suites, 22 pruebas aprobadas, 0 fallidas, 0 omitidas**.
Cubren adquisición concurrente, duplicados SQS, caída de Outbox, mensajes
perdidos, consumidor tardío, objeto S3 válido o corrupto tras caída SQL,
indisponibilidad S3, destino ausente o en eliminación, DLQ, lease vencido,
temporal ausente, cancelación durante reintento, limpieza fallida, retención y
la independencia de los ciclos del trabajador. Una ejecución previa en la misma
base poblada dejó fuera del primer lote un caso nuevo; la prueba ahora sitúa su
lease antes de los demás y pasó sobre esa base poblada.

## Regresiones y extremo a extremo

Las cuatro suites `cancel*.integration.test.ts` y la prueba de lease de O10:
**8/8 aprobadas** en el proyecto aislado. Las tres pruebas de fallos de carga
de O06: **3/3 aprobadas** en un segundo proyecto limpio
`drive-clone-o13-regression`. Una ejecución previa sobre la base con historial
de O13 alcanzó el límite de diez eventos Outbox por lote antes del evento de
O06; es aislamiento de la prueba heredada, no un fallo del publicador.

Con el trabajador activo en el segundo proyecto, `upload.integration.test.ts`
aprobó **3/3**, incluida la comparación de bytes del objeto S3. También se
detuvo el trabajador, se preparó una carga con intento y lease vencido y se
reinició. La observación en PostgreSQL y S3 fue: `COMPLETED`, dos intentos,
recurso `ACTIVE`, objeto de 33 bytes. Los scripts temporales de esta comprobación
se eliminaron.

## Chequeos generales

`npm run check` se ejecutó en una copia Linux aislada bajo `/tmp/o13check`, con
PostgreSQL y LocalStack disponibles. Se normalizaron los finales de línea de
`scripts/*.sh` de la copia porque el montaje Windows entregaba CRLF a `sh`.
El comando final dentro de esa copia fue `cd /tmp/o13check && npm run check`.
Resultado: **32 suites aprobadas, 21 omitidas; 109 pruebas aprobadas, 45
omitidas; salida 0**. Las suites de integración condicionadas por variables de
entorno se ejecutaron por separado arriba. Se comprobaron también `build`,
`git diff --check` y los límites de 150 líneas de los archivos de código.

## Pendiente externo

La coordinación con el trabajador de borrados de O12 queda pendiente porque
O12 aún no está integrado en `main`. O13 verifica que un destino en eliminación
no se publica. La PR permanece para revisión manual.
