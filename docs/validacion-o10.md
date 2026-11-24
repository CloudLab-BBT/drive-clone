# O10: cancelación de cargas

## Contrato y transiciones

`POST /api/v1/uploads/{id}/cancel` exige sesión, Origin y CSRF. Solo el propietario
puede consultar o cancelar su carga; para otro usuario responde 404. La operación
acepta `CREATED`, `RECEIVING`, `QUEUED` y `PROCESSING`, devuelve 200 y es
idempotente en `CANCEL_REQUESTED` y `CANCELLED`. Una carga `COMPLETED` o `FAILED`
devuelve 409 `STATE_CONFLICT`.

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
lease. El conciliador reintenta las limpiezas pendientes cada 20 segundos. Un
mensaje SQS duplicado de una carga cancelada se reconoce sin volver a publicarla.

## Evidencia

- `docker compose -p drive-clone-o10-test up -d --build`: servicios sanos.
- `docker compose -p drive-clone-o10-test stop worker`: aísla las carreras de las
  pruebas del consumidor de fondo.
- `docker compose -p drive-clone-o10-test run --rm -v
"${PWD}/apps/server/src/modules/uploads:/app/apps/server/src/modules/uploads"
-e RUN_UPLOAD_FAILURES=true -e RUN_UPLOAD_INTEGRATION=true api npx vitest run
apps/server/src/modules/uploads/cancel.integration.test.ts
apps/server/src/modules/uploads/cancel-api.integration.test.ts`: 5 pruebas pasan.
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

## Limitaciones verificadas

`npm run check` se detiene en `format:check`. Marca nueve archivos sin cambios de
O10 que ya estaban en `main` (`.github/workflows/ci.yml`, `.prettierrc.json`,
`README.md`, `apps/web/tsconfig.json`, `docs/controles-calidad.md`,
`docs/decisiones.md`, `eslint.config.js` y las configuraciones de Vitest), además
de archivos modificados para O10. Se conservó el estilo compacto del módulo para
respetar el límite de 150 líneas por archivo de código. Las demás puertas se
ejecutaron por separado y aprobaron.

No hay implementación de lotes O09 ni de eliminación de carpetas que pueda iniciar
una cancelación. Esas pruebas de integración quedan pendientes de dichas tareas.
