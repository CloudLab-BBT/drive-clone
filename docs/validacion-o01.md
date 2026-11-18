# Evidencia de O01

Fecha de verificación: 2026-11-17. Versión del contrato: 1.0.0.

## Entregables y aceptación

| Entregable / criterio | Referencia | Resultado |
| --- | --- | --- |
| API HTTP/OpenAPI, entradas, respuestas y errores | `packages/contracts/src/operations.ts`, `openapi.ts`, `generated/openapi.json`; `docs/api.md` | Especificadas 23 operaciones con esquemas, sesión y CSRF declarados |
| Mensajes versionados | `src/uploads.ts`, `generated/*message.v1.schema.json` | UPLOAD/DELETE v1 cerrados, UUID y sin binarios/rutas |
| Modelo con restricciones | `docs/modelo-datos.md` | Entidades, inventario de intentos, relaciones, índices, bloqueos y fronteras transaccionales definidos; sin migraciones ejecutadas |
| Tabla de transiciones válidas e inválidas | `docs/estados.md` | Estados de Upload/Resource/Deletion, carrera cancelación/finalización y recuperación especificados |
| Permisos, rechazo y herencia | `docs/politicas.md`; `src/authorization.ts` | Matriz y puerto común de O05 definidos, sin implementación de política |
| Formatos, límites y limpieza | `docs/politicas.md`, `docs/estados.md` | Alcance y resultados de rechazo concretados; inspección de archivos no implementada |
| Decisiones abiertas reales | `docs/decisiones.md` | Validaciones pendientes y condiciones de cierre registradas |
| Cada funcionalidad trazada | Matriz siguiente | Cubierta documentalmente, sin acreditar ejecución |
| Versión compartida del contrato | Paquete `@drive-clone/contracts` 1.0.0, lockfile y artefactos | Pendiente de revisión y adopción por los consumidores |

## Trazabilidad de pauta a resultado comprobable

| Requisito | Operación / componente acordado | Comprobación funcional futura |
| --- | --- | --- |
| F01 archivos y formatos | POST /uploads, PUT /uploads/:id/content y trabajador UPLOAD → S3 | Formato aceptado, archivo completo y descarga con bytes idénticos |
| F02 drag & drop | React → mismas operaciones de carga | Arrastrar selección y obtener COMPLETED, con alternativa por teclado |
| F03 carpetas | POST /folders, GET /folders/:id/children | Persistencia, nombres, profundidad y árbol visible |
| F04 múltiples usuarios | /auth/register, /auth/login, /auth/me y autorización común | Separación de recursos y rechazo a cliente alternativo |
| F05 cancelación | POST /uploads/:id/cancel y estados | Cancelar en cada fase, sin publicar incompleto; limpieza reconciliada |
| F06 descarga | GET /files/:id/download | Autorización, attachment y bytes idénticos |
| F07 READ/EDIT | Puerto común, PATCH/DELETE /resources/:id | READ no elimina, EDIT renombra/elimina, raíz protegida |
| F08 compartir por username | PUT/DELETE /resources/:id/shares y GET /shared | Username normalizado, herencia, revocación y permiso restante |
| T01 React | `docs/arquitectura.md`, matriz de versiones | Build/interfaz en tareas posteriores |
| T02 backend justificado | Fastify modular por capas, `docs/arquitectura.md` | Presentación explica responsabilidades/transacciones |
| T03 bucket LocalStack | Adaptador S3 y requisitos O02 | Objeto escrito, reinicio y lectura del mismo objeto |
| T04 contenedores | Cinco servicios acordados en arquitectura | Arranque limpio Compose, sin credenciales en repositorio |
| T05 cola en carga | QUEUED + outbox → SQS → trabajador → S3 | Evidencia real de mensaje consumido y recurso publicado |

## Revisión documental de los tres escenarios exigidos

Estos son recorridos lógicos de especificación, no tests de servicios. Procedimiento: contrastar cada paso con operaciones, esquemas, tabla de permisos y transiciones; comprobar que no exige un endpoint o estado inexistente.

1. **Propietario carga/descarga:** sesión/CSRF → POST uploads(parentId propio,name,size) 201 CREATED → PUT multipart 202 QUEUED → outbox UPLOAD v1 → lease PROCESSING → publicación transaccional COMPLETED/ACTIVE → GET files/:id/download 200. Antes de completar, Resource no es visible; la consulta Upload sí. Resultado documental: consistente. Referencias: `operations.ts` createUpload/receiveContent/download; `estados.md` tabla Upload y `modelo-datos.md` transacción de finalización.
2. **Receptor READ intenta eliminar:** concesión READ visible → DELETE confirmado con sesión/CSRF válidos → política visible=true, allowed=false, effectivePermission=READ → 403 FORBIDDEN, sin Deletion ni cambio de árbol. Si recurso invisible: 404. Si raíz: 403 incluso OWNER. Resultado documental: rechazo definido. Referencias: `authorization.ts`, `politicas.md` matriz, `api.md` errores. No se acredita rechazo HTTP real.
3. **Cancelar coincide con finalizar:** ambas operaciones bloquean propietario y Upload en mismo orden; si finaliza primero, COMPLETED y cancelación 409; si cancelación gana, CANCEL_REQUESTED impide publicar, se limpia y termina CANCELLED. Lease/attemptId viejos no confirman; objetos tardíos quedan inventariados. Resultado documental: hay un único ganador válido, terminales no se revierten. Referencias: `modelo-datos.md` fronteras 4–5, `estados.md` cancelación e inventario. La carrera debe reproducirse realmente en O10/O13.

## Checks ejecutados y resultados

| Procedimiento | Resultado real | Alcance |
| --- | --- | --- |
| `npm install` | 56 paquetes añadidos; auditoría informó cero vulnerabilidades | Instalación local y lockfile; no es un análisis continuo |
| `npm run contracts:generate` | Aprobado, tres artefactos JSON generados | Generación determinista desde fuentes |
| `npm run check` | Aprobado: TypeScript strict, contratos sincronizados y 28 pruebas en dos archivos | Solo contratos; incluye validez OpenAPI, límites, permisos declarados, mensajes, CSRF declarado y campos privados rechazados |
| `git diff --check` y revisión de archivos nuevos | Aprobado | Sin errores de whitespace; alcance O01 |
| Revisión de líneas y documentación por carpeta | Aprobado | Código nuevo <=150 líneas por archivo y README por carpeta relevante |
| API/DB/LocalStack, permisos reales, concurrencia, build de aplicaciones y E2E | No ejecutado | Componentes pendientes de implementación |
| CI remoto y persistencia tras reinicio | No ejecutado | Requieren el entorno de servicios y su configuración de automatización |

Para reproducir la validación desde la raíz: `npm ci`, `npm run contracts:generate` y `npm run check`. Las pruebas utilizan datos sintéticos y validan esquemas con Ajv y swagger-parser; no requieren servicios externos.

## Estado

Los contratos y la documentación están preparados para revisión. Las comprobaciones locales aprobaron; la adopción de la versión 1.0.0 sigue pendiente. La integración con la API, PostgreSQL y LocalStack se validará cuando esos componentes estén implementados.
