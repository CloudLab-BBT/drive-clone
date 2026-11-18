# Contratos generados

No editar manualmente. Regenerar desde raíz con `npm run contracts:generate`.

- `openapi.json`: OpenAPI 3.1.0, prefijo /api/v1, entradas/respuestas/errores y requisitos de sesión/CSRF de 23 operaciones. Se consume para documentación y pruebas de contrato futuras.
- `upload-message.v1.schema.json`: JSON Schema draft-07 de mensaje UPLOAD v1 con id UUID.
- `delete-message.v1.schema.json`: JSON Schema draft-07 de mensaje DELETE v1 con id UUID.

Los mensajes son cerrados, sin rutas/binarios/secretos. Los consumidores deben validar antes de adquirir trabajo de PostgreSQL. El productor outbox genera el mismo formato. Ningún artefacto implica que exista un servidor o una cola real.
