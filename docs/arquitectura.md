# Alcance y arquitectura

## Alcance

Guardar y descargar archivos, múltiples usuarios, carpetas, carga múltiple con drag & drop, cancelación, compartición interna por username y permisos READ/EDIT. EDIT significa renombrar/eliminar; no modifica contenido ni permite subir en carpetas ajenas.

No incluye movimientos, enlaces públicos, edición colaborativa, conversión, descarga de carpetas, antivirus, organizaciones, infraestructura distribuida ni despliegue automático.

## Componentes

```text
Navegador → web/NGINX → API → PostgreSQL
                        ├→ temporal compartido
                        └→ SQS/LocalStack
                                 ↓
                           trabajador → S3/LocalStack
                                 └→ PostgreSQL + temporal
```

Cinco servicios permanentes: web, api, worker, postgres y localstack. API y worker usan la misma imagen backend con comandos distintos. Inicialización, migración y tests son ejecuciones adicionales. Solo web se publica por loopback; diagnósticos mediante perfil explícito. No mantener transacciones SQL durante red o transferencia de archivos.

## Estructura acordada

| Ruta | Responsabilidad y dependencias |
| --- | --- |
| `apps/web/` | React por funcionalidades; consume contratos y `/api/v1`. |
| `apps/server/src/modules/identity/` | Registro, sesiones y raíz; usa persistencia. |
| `apps/server/src/modules/resources/` | Árbol, consulta y edición; usa autorización común. |
| `apps/server/src/modules/sharing/` | Concesiones, herencia y política común. |
| `apps/server/src/modules/uploads/` | Reservas, recepción, estado y cancelación. |
| `apps/server/src/platform/` | Configuración, DB, S3, SQS y logs. |
| `apps/server/src/worker/` | Outbox, consumo, limpieza y recuperación en ciclos independientes. |
| `packages/contracts/` | Esquemas HTTP, DTO derivados, OpenAPI y mensajes v1. |
| `infra/` | Dockerfiles, proxy y provisión idempotente. |
| `tests/e2e/` | Navegador y datos sintéticos de tres usuarios. |
| `tests/performance/` | k6 y condiciones de medición. |
| `docs/` | Decisiones, operación y evidencia. |

Actualmente existen `packages/contracts/` y `docs/`. Las demás rutas describen la estructura prevista para la implementación.

## Separación de responsabilidades

Transporte valida esquemas y transforma HTTP; casos de uso ejecutan reglas sin request/reply; repositorios específicos realizan consultas/transacciones; adaptadores encapsulan S3/SQS. Fábricas y parámetros componen dependencias. La política común devuelve visibilidad, permiso efectivo y acciones permitidas. El frontend muestra esos resultados y el servidor reevalúa cada operación.

No se agregan microservicios, Redis, JWT, GraphQL, CQRS, event sourcing, Kubernetes ni un framework de inyección.

## Dependencias de implementación

El entorno y la persistencia son necesarios para implementar identidad y autorización. Las cargas y las carpetas dependen de esos componentes; la compartición y la edición requieren, además, consulta y navegación de recursos.

## Límite operativo

El volumen temporal compartido limita la ejecución a un host. Antes de integrar almacenamiento y colas se deben validar el acceso a LocalStack, la persistencia tras reinicio y las versiones de las imágenes. La emulación local no permite evaluar las garantías de disponibilidad de AWS.
