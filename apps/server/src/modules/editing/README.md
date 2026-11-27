# Edición de recursos

- `routes.ts` conecta Fastify con los casos de uso de renombrado, solicitud de
  borrado y consulta de borrado. Valida los contratos compartidos, sesión y
  CSRF en mutaciones.
- `rename.ts` recibe el actor, el recurso y el nombre. Normaliza el nombre,
  conserva la extensión de archivos y actualiza únicamente metadatos. Devuelve
  el recurso con su permiso efectivo y omite el padre para receptores.
- `transaction.ts` administra la transacción PostgreSQL, bloquea al propietario
  y comprueba la decisión de autorización común para renombrar o eliminar.
- `editing.fixture.ts` prepara sesiones, peticiones HTTP y archivos para
  las pruebas de edición y eliminación.
- `editing.integration.test.ts` comprueba nombres, roles, conservación del identificador,
  contenido y concesiones con PostgreSQL y LocalStack.
