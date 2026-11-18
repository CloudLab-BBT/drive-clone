# Clon de Drive

Aplicación de almacenamiento y compartición de archivos para el Taller 2 de Cloud Computing. Arquitectura basada en React, Fastify, PostgreSQL y LocalStack S3/SQS.

## Estado del proyecto

El repositorio contiene la especificación v1 de la API, los mensajes de cola y los esquemas compartidos, junto con sus pruebas de contrato. La interfaz, la API, el trabajador y las migraciones están pendientes de implementación.

## Requisitos

- Node.js 24 LTS, versión 24.12 o superior dentro de la rama 24.
- npm.

## Verificación de contratos

```sh
npm ci
npm run contracts:generate
npm run check
```

`contracts:generate` actualiza OpenAPI y los esquemas de mensajes. `check` comprueba los tipos, la sincronización de los archivos generados y las pruebas. Estos comandos no requieren base de datos ni credenciales.

## Documentación

- [Arquitectura y especificaciones](docs/README.md).
- [Uso del paquete de contratos](packages/contracts/README.md).
- [Resultados de validación](docs/validacion-o01.md).
