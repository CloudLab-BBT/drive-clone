# Clon de Drive

Aplicación de almacenamiento y compartición de archivos para el Taller 2 de Cloud Computing. Arquitectura basada en React, Fastify, PostgreSQL y LocalStack S3/SQS.

## Estado del proyecto

El repositorio contiene la especificación v1 de la API, el entorno O02, registro y sesiones O04, autorización común O05 y el recorrido de primera carga O06. Las demás operaciones de archivos y la recuperación avanzada siguen sus tareas asignadas.

## Requisitos

- Node.js 24 LTS, versión 24.12 o superior dentro de la rama 24.
- npm.

## Verificación de contratos

```sh
npm ci
npm run contracts:generate
npm run check
```

`contracts:generate` actualiza OpenAPI y los esquemas de mensajes. `check`
ejecuta formato, lint, tipos, sincronización de contratos, límite de líneas y
todas las pruebas; para mantenerlo aislado de los servicios de desarrollo,
ejecútelo mediante `./scripts/test-integration-isolated.sh`. Las pruebas
unitarias con cobertura (`npm run test:coverage`) no requieren base de datos.

## Documentación

- [Arquitectura y especificaciones](docs/README.md).
- [Uso del paquete de contratos](packages/contracts/README.md).
- [Resultados de validación](docs/validacion-o01.md).
- [Operación del entorno O02](docs/operacion-o02.md).
- [Resultados de validación O02](docs/validacion-o02.md).
- [Controles de calidad y CI](docs/controles-calidad.md).
- [Primera carga por cola O06](docs/carga-o06.md).
- [Resultados de validación O06](docs/validacion-o06.md).
