# Documentación del proyecto

Especificación v1 de la API, los mensajes de cola y las políticas del proyecto. Los ejemplos utilizan datos sintéticos.

| Archivo | Responsabilidad y conexión |
| --- | --- |
| `arquitectura.md` | Alcance, componentes, estructura y dependencias de las aplicaciones. |
| `api.md` | Semántica HTTP, seguridad, errores y paginación; complementa OpenAPI generado. |
| `modelo-datos.md` | Campos, relaciones, restricciones y transacciones que concretarán las migraciones. |
| `politicas.md` | Reglas compartidas de permisos, nombres, archivos y límites. |
| `estados.md` | Transiciones, leases, reintentos, cancelación y borrado durable. |
| `decisiones.md` | Tecnologías, versiones, decisiones y validaciones pendientes. |
| `validacion-o01.md` | Trazabilidad de requisitos, escenarios revisados y resultados de las comprobaciones. |

Los esquemas de `packages/contracts/src` definen los cuerpos y tipos públicos. OpenAPI y los mensajes se generan desde esas fuentes. Cada cambio de contrato requiere actualizar la documentación, regenerar los artefactos y comprobar la compatibilidad de los consumidores. La autorización se centraliza en la política común.
