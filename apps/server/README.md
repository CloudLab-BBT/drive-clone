# Servidor O02

`src/api.ts` expone salud HTTP; `src/worker.ts` inicia el proceso separado. `src/platform/config.ts` lee variables, `clients.ts` crea conexiones PostgreSQL/S3/SQS, y `health.ts` comprueba dependencias con timeout. `src/bootstrap.ts` crea o verifica bucket, cola y DLQ; se ejecuta después de LocalStack. No se procesan mensajes en O02.

`prisma/schema.prisma` define entidades y relaciones; `prisma/migrations/` materializa esquema, índices y restricciones. `prisma.config.ts` configura Prisma 7 ESM. `npm run generate -w @drive-clone/server` genera el cliente fuera de Git; `npm run migrate -w @drive-clone/server` requiere `DATABASE_URL` real.

Las funciones de salud devuelven booleanos por dependencia; `bounded(name, check, timeoutMs)` recibe un nombre y una operación asíncrona y devuelve `[nombre, disponible]`. Los clientes usan `DATABASE_URL`, `AWS_ENDPOINT`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, `SQS_QUEUE`, `SQS_DLQ` y `TEMP_DIR`.

[Autorización común (O05)](src/modules/authorization/README.md) documenta la política, las consultas de visibilidad, el uso desde rutas y su validación.

[Primera carga por cola (O06)](../../docs/carga-o06.md) documenta endpoints, estados, temporal, mensaje y límites del recorrido.
