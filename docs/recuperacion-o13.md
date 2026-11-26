# O13: recuperación de cargas

## Estados e idempotencia

`Outbox` es la fuente persistente de trabajo `UPLOAD`. Se marca `publishedAt` solo
después de la respuesta satisfactoria de SQS. Si SQS recibió el mensaje pero el
proceso cayó antes de esa actualización, el publicador puede enviarlo otra vez.
Los mensajes repetidos no crean otro recurso: la adquisición exige `QUEUED`, toma
un bloqueo SQL y crea un `UploadAttempt` con UUID y clave S3 propia. El contador
`attemptCount` aumenta solo en esa adquisición. `QueueObservation.receiveCount`
registra por separado las recepciones comunicadas por SQS.

Un intento `PROCESSING` tiene `attemptId` y lease de 60 segundos, renovado cada
20 segundos junto con la visibilidad del mensaje. Solo el intento vigente con
lease válido puede pasar a `COMPLETED` y activar el recurso en la misma
transacción. Cada escritura usa una clave distinta y `If-None-Match: *` para no
sobrescribir un objeto existente. Un consumidor antiguo descarta su propia clave
si perdió el lease. Los mensajes se eliminan de SQS tras comprobar un estado
terminal persistido; los demás se reentregan o tienen un nuevo evento Outbox.

## Ventanas de fallo

| Ventana                                      | Recuperación                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Antes de publicar Outbox                     | El evento sigue pendiente; se reintenta tras 5, 20 y luego 60 segundos.                          |
| SQS confirma, SQL aún no marca `publishedAt` | Puede haber dos mensajes; la adquisición atómica conserva un solo intento activo.                |
| Antes de escribir en S3                      | Al vencer el lease, se diagnostica el intento y se reencola con otra clave.                      |
| S3 escrito, SQL aún no confirma              | El conciliador verifica tamaño y SHA-256 del objeto y puede confirmar ese mismo intento vencido. |
| S3 o SQL no disponibles                      | Se conserva el estado persistente para un ciclo posterior; un objeto corrupto se descarta.       |
| Intento antiguo termina tarde                | No puede confirmar; elimina su clave sin tocar la publicada por otro intento.                    |
| Cancelación durante un reintento             | `CANCEL_REQUESTED` impide adquirir y publicar; la limpieza compartida completa `CANCELLED`.      |

Los intentos de negocio tienen un máximo de tres. Tras los dos primeros fallos
recuperables, la espera es de 5 y 20 segundos. Un temporal ausente, destino
inaccesible o tercer fallo termina en `FAILED`; `UploadAttempt.failureCode`
conserva la causa. El usuario debe crear una nueva intención de carga para
reintentar un fallo definitivo. Una carga `FAILED`, `COMPLETED` o `CANCELLED` no
se reactiva al reiniciar el trabajador.

El consumidor de la cola principal, el publicador Outbox, la conciliación y el
diagnóstico DLQ tienen ciclos independientes. El long polling de SQS no detiene
la publicación ni la renovación. La DLQ consulta PostgreSQL: despierta trabajos
`QUEUED`, registra `ACTIVE` para trabajo aún vigente y `TERMINAL` para estados
finales. El diagnóstico se guarda antes de confirmar el mensaje DLQ. La
conciliación también reconstruye un evento para una carga en cola cuyo último
envío tiene más de 60 segundos y carece de Outbox pendiente.

## Limpieza, retención y operación

Los objetos de intentos descartados quedan inventariados hasta que S3 confirma
su borrado. `cleanupPending` mantiene la limpieza de cargas fallidas o canceladas
en el mecanismo de O10; la cuota reservada se libera después de limpiar. La
conciliación elimina observaciones SQS y eventos Outbox `UPLOAD` publicados con
más de 30 días, en lotes de hasta 1000. Nunca elimina eventos sin publicar.
`UploadAttempt` se conserva con su carga para diagnosticarla.

Ante una carga detenida, consultar `Upload.status`, `attemptId`, `attemptCount`,
`leaseUntil`, `nextAttemptAt`, `errorCode` y `cleanupPending`; consultar después
`UploadAttempt.failureCode`, `Outbox.publishedAt/errorCode` y
`QueueObservation.receiveCount/outcome`. Verificar que el trabajador y sus
dependencias están sanos y ejecutar la conciliación normal. No cambiar a mano un
estado terminal ni reutilizar la clave S3 de un intento. Si la carga quedó en
`FAILED`, iniciar una carga nueva; si la limpieza sigue pendiente, restaurar S3
o el volumen temporal y dejar que el conciliador reintente.

O12 todavía no aporta un trabajador de borrados en `main`. O13 reutiliza la
limpieza de cargas de O10 y no crea un segundo borrador de recursos. La prueba
de coordinación con borrados pendientes de O12 se realizará cuando exista ese
mecanismo.
