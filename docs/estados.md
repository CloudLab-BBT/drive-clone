# Estados, mensajes y recuperación v1

## Mensajes

SQS estándar: JSON UTF-8 exactamente `{ "version": 1, "type": "UPLOAD", "id": "UUID" }` o type DELETE. Rechazar propiedades adicionales, versiones/tipos desconocidos e id inválido; registrar diagnóstico seguro y enviar a DLQ según política de recepción. No ejecutar mensajes desconocidos ni deserializar clases. Esquemas en `packages/contracts/generated/*message.v1.schema.json`.

PostgreSQL es fuente de verdad. Un mensaje no lleva intento, binario, ruta ni credencial. Adquirir trabajo desde DB y comprobar estado/lease; mensajes duplicados terminales se confirman sin efectos. Consumidor debe leer la intención vigente aunque el mensaje sea viejo.

Long polling 20 s; visibilidad inicial 60 s y renovación cada 20 s; lease DB 60 s y renovación cada 20 s. Outbox, consumo y renovación tienen ciclos independientes. Al perder lease, abortar transferencia y no confirmar. Clave por intento: `uploads/{uploadId}/{attemptId}`; registrar UploadAttempt antes de S3, nunca derivar de nombre visible.

Outbox adquiere lease de publicación 60 s, registra attemptId, publica y marca publishedAt solo si aún posee lease. Crash entre envío y marca produce duplicado esperado. Error de envío: reintentar con backoff 5, 20, 60 s y luego 60 s; no descartar automáticamente. Reintento de negocio reactiva outbox atómicamente con availableAt. Un trabajo QUEUED aún no elegible no consume intento y no debe quedar perdido por confirmar su único mensaje sin reactivar outbox.

Máximo tres intentos de negocio (incrementar solo al adquirir PROCESSING). Backoff antes del segundo 5 s y antes del tercero 20 s. SQS maxReceiveCount inicial 20 antes de DLQ; no equivale a tres intentos de negocio. El reconciliador vuelve a programar trabajos elegibles sin mensaje; revisar DLQ no implica repetir efectos. O13 comprueba estos parámetros con duplicados y reinicios reales.

## Tabla de Upload

Todas las transiciones no enumeradas están prohibidas. El cliente no envía estados arbitrarios. CREATED/RECEIVING/QUEUED/PROCESSING/CANCEL_REQUESTED son activos; COMPLETED/FAILED/CANCELLED terminales.

| Origen | Evento/condición | Destino | Efecto atómico o posterior |
| --- | --- | --- | --- |
| CREATED | PUT adquiere recepción | RECEIVING | Una única recepción, temporal parcial interno |
| CREATED | Quince minutos sin empezar | FAILED | EXPIRED y limpieza de reserva |
| RECEIVING | Streaming completo, tamaño/hash/formato válidos, padre activo | QUEUED | Renombrado atómico de temporal antes; estado + outbox en transacción |
| RECEIVING | Interrupción, timeout de diez minutos o inválido | FAILED | Error seguro y cleanupPending |
| QUEUED | Elegible y lease adquirido | PROCESSING | Nuevo attemptId, inventario de objeto e incremento de intento |
| PROCESSING | S3 completo + lease vigente + sin cancelación + padre activo | COMPLETED | Publicar objeto/recurso y trasladar cuota una vez |
| PROCESSING | Fallo transitorio y quedan intentos | QUEUED | Descartar intento, limpieza reconciliable y outbox con demora |
| PROCESSING | Fallo definitivo o tercer intento fallido | FAILED | cleanupPending; recurso nunca accesible |
| PROCESSING | Lease vencido | QUEUED o FAILED | Reconciliador invalida intento; FAILED si agotado, ningún intento viejo confirma |
| CREATED/RECEIVING/QUEUED/PROCESSING | Cancelación gana comparación de estado | CANCEL_REQUESTED | Registrar intención; abortar transferencia cuando sea posible |
| CANCEL_REQUESTED | Trabajadores detenidos/leases invalidados y limpieza confirmada | CANCELLED | Liberar reserva una vez; sin archivo accesible |

Cancelación repetida en CANCEL_REQUESTED/CANCELLED: 200 con mismo estado; en FAILED: 200 conservando FAILED y limpieza pendiente; en COMPLETED: 409 STATE_CONFLICT. CREATED → COMPLETED, QUEUED → RECEIVING y cualquier salida de terminal son inválidas. PUT repetido fuera de CREATED devuelve 409: reintento manual tras terminal crea otra intención, sin prometer idempotencia de POST. El nombre puede seguir reservado hasta limpieza.

El error de recepción después de cancelación no sobrescribe CANCEL_REQUESTED con FAILED. Completar y cancelar comparten bloqueo/comparación atómica: gana exactamente uno. Lease vencido no autoriza borrar un temporal todavía usado sin invalidar al intento anterior; los objetos tardíos de intentos descartados quedan en inventario y se reconcilian.

COMPLETED puede tener limpieza pendiente de temporales/intentos descartados; esto no retira el objeto publicado. FAILED reserva cuota hasta confirmar ausencia de temporales/objetos. Si cancelación tiene limpieza pendiente, permanece CANCEL_REQUESTED; no declarar CANCELLED antes. GET incluye cleanupPending sin rutas internas.

## Resource

FOLDER nace ACTIVE. FILE nace RESERVED, pasa ACTIVE solo al confirmar Upload; puede pasar UNAVAILABLE si se detecta pérdida del objeto publicado. RESERVED/ACTIVE/UNAVAILABLE pasan DELETING bajo bloqueo; al confirmar limpieza se retiran metadatos. Fallo/cancelación sin publicación retira la reserva tras limpiar. Ninguno de RESERVED/UNAVAILABLE/DELETING se lista o descarga como recurso activo. Propietario observa estado mediante Upload/Deletion; diagnóstico de pérdida se registra sin inventar recuperación.

## Deletion

PENDING → PROCESSING al adquirir lease; PROCESSING → COMPLETED solo tras objetos, intentos, temporales y metadatos retirados. Fallo transitorio: PROCESSING → PENDING con backoff 5/20 s, máximo tres intentos de ciclo. Lease vencido recupera PENDING o FAILED si agotado. Fallo definitivo/agotar intentos: FAILED con CLEANUP_FAILED, recursos siguen inaccesibles y la cuota no se libera antes de limpiar.

FAILED es estado del ciclo automático: no existe endpoint público de reintento en v1. O13 documentará una operación interna de recuperación supervisada que reactive PENDING tras reparar la causa, con autorización operativa y registro; nunca editar datos de producción sin procedimiento. DELETE repetido de un objetivo DELETING devuelve 202 con la misma Deletion solo al solicitante/propietario; otro editor recibe 404. COMPLETED consultable, nuevos DELETE del id retirado 404. Una carpeta hija ya DELETING impide iniciar borrado superpuesto: 409.

Procesar lotes idempotentes, sin SQL abierto durante S3. Esperar invalidación/cancelación de cargas para impedir publicación y reconciliar objetos tardíos. Snapshot durable: Resource.deletionId y UploadAttempt preservan qué limpiar. Al terminar, cancelar o fallar no perder inventario pendiente.

## Arranque y recuperación

Reconciliar outbox, leases vencidos, CREATED expirados, recepciones abandonadas y objetos descartados; no borrar por edad sin verificar lease/estado. Comprobar objetos publicados al iniciar; ausentes → UNAVAILABLE y alerta. Readiness no afirma recuperación completa por tener proceso vivo. Restauración coordinada de PostgreSQL y objetos se comprobará antes de la entrega, sin afirmar garantías de nube real.
