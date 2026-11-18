# Registro de decisiones y compatibilidad

Fecha: 2026-11-17. Versión del contrato: 1.0.0. Este documento registra las tecnologías seleccionadas, las decisiones del contrato y las validaciones pendientes.

## Matriz de tecnologías

| Componente | Línea acordada / versión consultada | Estado |
| --- | --- | --- |
| Runtime | Node.js 24 LTS; local 24.16.0, mínimo operativo de contratos 24.12 | Verificado para herramientas O01; parche de imagen se fija O02 |
| Paquetes | npm workspaces; npm local 11.13.0 | Lockfile de contratos, no de servicios aún inexistentes |
| Contratos | @sinclair/typebox 0.34.52; OpenAPI 3.1.0; JSON Schema draft-07 en mensajes | Instalado y validado en O01 |
| Tipos y revisión | TypeScript 5.9.3, Vitest 5.1.0, Ajv 8.20.0, ajv-formats 3.0.1, swagger-parser 13.1.0 | Dependencias exclusivas de especificación/verificación |
| Frontend | React 19 (registro: 19.3.1), Vite (registro: 8.3.8), React Router, Axios, CSS Modules | O02 fija parches y verifica React/Vite/plugins juntos |
| API | Fastify 5 (registro: 5.12.8); @fastify/session 11.1.6; csrf-protection 8.0.2; swagger 9.9.5 | Versiones candidatas, no instaladas ni compatibilidad de conjunto probada |
| Datos | PostgreSQL 17; Prisma 7 (registro de esa línea: 7.10.1), adaptador pg | O02 fija parches/digests y valida migración limpia; no adoptar Prisma 8 preliminar |
| Objetos/cola | LocalStack oficial con S3/SQS/DLQ; SDK AWS JavaScript v3 | Plan/token/persistencia e imagen aún no comprobados |
| Sesiones | Cookie, store PostgreSQL, Argon2id | O04 implementa adaptador y seguridad sin JWT/Redis |
| Entrada | NGINX + React compilado; Docker Compose | O02 fija imágenes sin latest; Node Debian slim |
| Calidad posterior | Testing Library, Playwright, ESLint, Prettier; GitHub Actions, Gitleaks, análisis de paquetes/imágenes; k6 | O03/O14/O15 configuran según tarea, sin publicación |

Las versiones consultadas en npm son candidatas para los servicios pendientes. Su compatibilidad debe verificarse durante la configuración del entorno. El lockfile fija las dependencias instaladas del paquete de contratos.

## Decisiones del contrato

- Contratos públicos con propiedades explícitas, campos camelCase, UUID y timestamps; esquemas TypeBox como fuente de tipos derivados.
- OpenAPI generado a partir de registro declarativo de operaciones; las futuras rutas deben consumir estos mismos esquemas, no una copia. La comprobación contra servidor real corresponde a integración posterior. `tsconfig.json` aplica strict/NodeNext/noEmit; `package.json` agrupa generación, comprobación de deriva, tipos y Vitest; `package-lock.json` fija dependencias transitivas.
- Resource RESERVED/ACTIVE/UNAVAILABLE/DELETING y registros durables para intentos/borrado; inventario de objetos evita perder limpieza de intentos tardíos.
- Propietario bloqueado mediante fila User para mutaciones de árbol, cuota y carreras de publicación/borrado; sin transferencias de red bajo bloqueo.
- Cookie drive_session, CSRF por header, username normalizado, nombres NFC/minúsculas para duplicados; raíz protegida.
- Paginación cursor v1 con ámbito y tupla; PUT share 200 al crear/actualizar; revocación 200 con permiso restante.
- DELETE confirmado por query, sin endpoint extra; impacto definitivo transaccional, cliente advierte variación por concurrencia.
- Presupuesto de inspección ZIP, conservación de extensión al renombrar y parámetros de backoff/recepción/lease concretan decisiones operativas sin agregar funcionalidades.
- Cancelación de FAILED conserva FAILED; repetición no cambia terminal. Resource no es visible antes de publicación válida.

La versión 1.0.0 está pendiente de revisión y adopción como contrato común de los consumidores.

## Validaciones pendientes

| Componente | Referencia | Condición de cierre |
| --- | --- | --- |
| Contrato v1 | O01 | Registrar la revisión y la versión adoptada por sus consumidores. |
| Entorno y versiones | O02 | Construir imágenes fijadas, ejecutar migraciones y comprobar compatibilidad de plugins y dependencias. |
| LocalStack | O02 | Validar acceso, plan y persistencia: escribir objeto y mensaje, reiniciar y recuperarlos. |
| Sesiones y registro | O04 | Probar creación de raíz, regeneración, expiración, logout y protección de origen/CSRF. |
| Autorización común | O05 | Implementar y probar las decisiones por operación, propiedad y herencia. |
| Restricciones e inventario | O02/O04/O06/O12/O13 | Materializar el modelo en migraciones coordinadas y validar su integridad. |
| Validación de formatos | O06/O09 | Verificar firmas y estructuras con fixtures representativos y los límites de inspección definidos. |
| Recuperación de borrados | O12/O13 | Documentar y probar la recuperación supervisada de Deletion FAILED. |

## Fuentes verificadas

Referencias de compatibilidad y configuración consultadas para esta versión:

- [Prisma 7: actualización y adaptadores](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7) y [requisitos](https://docs.prisma.io/docs/orm/reference/system-requirements).
- [Fastify 5: soporte LTS](https://fastify.dev/docs/v5.0.x/Reference/LTS/).
- [LocalStack: persistencia](https://docs.localstack.cloud/aws/developer-tools/snapshots/persistence/) y [activación](https://docs.localstack.cloud/aws/getting-started/auth-token/).
- Registro oficial npm: `npm view <paquete> version engines --json` y `npm view prisma@7 version engines --json`. La línea fijada prevalece frente a un major nuevo/preliminar.

Cambios compatibles de contratos: incrementar minor y regenerar; correcciones descriptivas patch; campos obligatorios/estados/semántica incompatibles major con coordinación de consumidores. Mensajes v1 no admiten campos nuevos sin nueva versión; productor y consumidor deben acordar despliegue antes de emitirla.
