# Eliminaciones durables

- `request.ts` solicita la eliminación para un actor y recurso, y devuelve el
  trabajo con su impacto definitivo. Registra el subárbol, la cancelación de
  cargas, la retirada de concesiones y el mensaje Outbox en la misma transacción.
  También permite consultar el trabajo al solicitante y al propietario.
- `model.ts` define los estados persistentes y traduce una fila al contrato
  público sin exponer el lease ni los identificadores de los intentos.
- `jobs.ts` adquiere trabajos elegibles, contabiliza sus intentos y programa
  los reintentos con Outbox. Despierta trabajos cuyo mensaje pudo perderse y
  permite reactivar un fallo desde un entorno operativo autorizado.
- `worker.ts` recibe el identificador de trabajo y una función opcional de
  renovación de visibilidad SQS. Espera la limpieza de las cargas afectadas,
  borra las claves de cada lote y retira sus metadatos de hojas a raíz. Solo el
  intento vigente puede registrar progreso y ajustar la cuota.
- `deletion.integration.test.ts`, `deletion-failures.integration.test.ts` y
  `deletion-upload.integration.test.ts` cubren autorización, confirmación,
  repetición, fallos parciales y coordinación con cargas activas.
