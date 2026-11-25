# O10: cancelación de cargas

## Contrato y transiciones

`POST /api/v1/uploads/{id}/cancel` exige sesión, Origin y CSRF. Solo el propietario
puede consultar o cancelar su carga; para otro usuario responde 404. La operación
acepta `CREATED`, `RECEIVING`, `QUEUED` y `PROCESSING`, devuelve 200 y es
idempotente en `CANCEL_REQUESTED` y `CANCELLED`. Una carga `FAILED` devuelve 200
sin cambiar su estado ni `cleanupPending`. `COMPLETED` devuelve 409 `STATE_CONFLICT`.

La cancelación se confirma en PostgreSQL como `CANCEL_REQUESTED` antes de limpiar.
El bloqueo del propietario serializa la solicitud con la publicación. Si completar
gana la carrera, cancelar devuelve 409; si cancelar gana, el intento no puede
activar el recurso. La recepción consulta el estado durante el streaming y se
detiene cooperativamente. El navegador aborta el PUT tras recibir la confirmación
de cancelación y sigue consultando el estado hasta `CANCELLED`.

`cleanupPending` permanece en `true` mientras falte borrar el temporal o alguno
de los objetos S3 de los intentos. La cuota reservada se libera al confirmar la
limpieza y pasar a `CANCELLED`. Durante `RECEIVING`, se espera a que termine el
stream; durante `PROCESSING`, se espera al fin del intento o al vencimiento de su
lease. Al pasar a `RECEIVING` se persiste el nombre `.part` antes de escribir;
la limpieza busca ese archivo y su posible `.ready`. Si falla el borrado,
`CANCEL_REQUESTED`, `cleanupPending=true` y la cuota reservada se conservan hasta
un reintento satisfactorio. El conciliador reintenta cada 20 segundos. Un
mensaje SQS duplicado de una carga cancelada se reconoce sin volver a publicarla.

## Evidencia

- `docker compose -p drive-clone-o10-test up -d --build`: servicios sanos.
- `docker compose -p drive-clone-o10-test stop worker`: aísla las carreras de las
  pruebas del consumidor de fondo.
- `docker compose -p drive-clone-o10-test run --rm -v
"${PWD}/apps/server/src/modules/uploads:/app/apps/server/src/modules/uploads"
-e RUN_UPLOAD_FAILURES=true -e RUN_UPLOAD_INTEGRATION=true api npx vitest run
apps/server/src/modules/uploads/cancel.integration.test.ts
apps/server/src/modules/uploads/cancel-race.integration.test.ts
apps/server/src/modules/uploads/cancel-api.integration.test.ts
apps/server/src/modules/uploads/cancel-terminal-api.integration.test.ts`: esta
  orden anterior a la corrección pasó 5 pruebas; la ejecución actual de las 7
  pruebas se verificará en CI.
  Cubren los cuatro estados cancelables, repetición, seguridad, fallo de limpieza,
  reintento, carrera durante S3, late cancel y redelivery.
- Mismo contenedor con `RUN_UPLOAD_FAILURES=true` y las suites
  `upload-failures.integration.test.ts` y `lease.integration.test.ts`: 4 pruebas
  pasan.
- Contenedor con el repositorio montado en `/workspace`, `npm ci --quiet && npm
test`: 99 pruebas pasan; 14 se omiten por banderas de integración.
- `npm run lint`, `npm run typecheck`, `npm run contracts:check`, `npm run build`
  y `scripts/check-file-lines.sh`: pasan. La prueba de React para cancelación
  confirmada pasa dentro de la suite general.

## Correcciones y verificación actual

- Prettier se aplicó a los archivos de O10. Los archivos que excedían 150 líneas
  se dividieron por responsabilidad. `format:check` revisa los archivos del
  cambio y deja fuera la lista fija de archivos anteriores a O10 que fallaban
  por formato en `main`.
- El [reporte redactado de Gitleaks](https://github.com/CloudLab-BBT/drive-clone/actions/runs/45302835439)
  señaló `generic-api-key` en la línea 32 de `cancel-api.integration.test.ts`
  del commit `b171ef7`. Es la contraseña fija de una cuenta creada por la prueba,
  no una credencial de servicio. La excepción histórica limita regla, archivo y
  commit; la excepción del árbol de trabajo limita regla, archivo y línea.
- `npm run typecheck`, `npm run lint`, `npm run contracts:check` y
  `npm run test:unit`: pasan localmente; esta última ejecutó 73 pruebas.
- `BASE_REF=origin/main scripts/check-file-lines.sh` y
  `scripts/format-check.sh`: pasan. En Windows se invocaron con Git Bash.
- [GitHub Actions, commit `c9bf789`](https://github.com/CloudLab-BBT/drive-clone/actions/runs/45649078591):
  `quality`, `unit`, `integration`, `build-and-scan` y `localstack-pro` pasan.
  Esto confirma también Gitleaks en historial y árbol de trabajo.
- `docker compose -p drive-clone-o10-verify up -d --build`: el entorno local
  quedó detenido en `RUN npm ci` durante la construcción de las imágenes; se
  interrumpió sin iniciar servicios. Las suites O10 protegidas por
  `RUN_UPLOAD_FAILURES` y `RUN_UPLOAD_INTEGRATION` no se volvieron a ejecutar.
  El trabajo de CI general tampoco activa esas banderas: las pruebas nuevas
  quedan compiladas, pero su ejecución con PostgreSQL y LocalStack sigue
  pendiente.

## Pendientes

No hay implementación de lotes O09 ni de eliminación de carpetas que pueda iniciar
una cancelación. Esas pruebas de integración quedan pendientes de dichas tareas.
