# Verificación de contratos

`schemas.test.ts` valida mensajes versionados y entradas mediante Ajv con formatos: UUID, tipos, propiedades ajenas, nombres, tamaño, credenciales, permisos, confirmación y paginación. Los parámetros de cada caso son entradas sintéticas; se espera true/false según contrato, sin servicios o datos reales.

`openapi.test.ts` carga el artefacto y lo valida con swagger-parser; comprueba unicidad/cobertura de operaciones, metadatos de sesión/CSRF, parámetros y tipos binarios. Los assertions devuelven éxito/error de Vitest. Son comprobaciones de esquema y seguridad declarada: no acreditan autenticación, autorización ni concurrencia reales.

Desde raíz `npm test`; `npm run check` añade tipos y ausencia de deriva. Los tres escenarios documentales de aceptación están en `docs/validacion-o01.md`. Tests de API, DB, cola, almacenamiento, navegador y fallos pertenecen a las tareas que implementen esos componentes.
