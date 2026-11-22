# Autorización común

O05 aplica la política de O01 a archivos y carpetas. La creación de una carga usa
`CREATE_CHILD` sobre la carpeta de destino. La consulta y cancelación del trabajo
persistido deben comprobar su autoría en el caso de uso de cargas.

| Archivo | Responsabilidad |
| --- | --- |
| `policy.ts` | `decide(resource, action)` aplica la matriz y la protección de raíz. Devuelve una decisión pública del contrato interno. |
| `access-query.ts` | Consulta parametrizada de PostgreSQL. Reconstruye hasta diez niveles del árbol y combina concesiones para el actor. |
| `service.ts` | `AuthorizationService(db)` implementa el puerto de O01. Acepta un cliente o pool de PostgreSQL. |
| `http.ts` | `requireResourceAccess(service)` toma el actor de `request.user.id`, traduce las decisiones a 401, 403 o 404 y devuelve el permiso efectivo al autorizar. |
| `index.ts` | Entrada pública del módulo. |
| `policy.test.ts`, `http.test.ts` | Matriz de acciones y traducción HTTP, con datos sintéticos. |
| `http.integration.test.ts` | Integra el guard de O04 y la política con Fastify y PostgreSQL, mediante una ruta exclusiva de la prueba. |
| `access.integration.test.ts` | Consultas reales en PostgreSQL con datos generados y reversión por prueba. |

`evaluate({ actorId, resourceId, action })` devuelve visibilidad, autorización y
permiso efectivo. Los listados `listChildren(actorId, folderId, page?)` y
`listShared(actorId, page?)` devuelven IDs, tipo, indicador de raíz, permiso
efectivo y una frontera para la página siguiente. La carpeta no visible o de tipo
incorrecto produce `null`. Una carpeta visible sin hijos accesibles devuelve
una página vacía. Las consultas no devuelven campos de ancestros ni `parentId`.
`listShared` enumera entradas con concesión directa y calcula su permiso
efectivo, incluida la herencia.

La página admite `limit` (25 por defecto, de 1 a 100) y una frontera interna
`after: { createdAt, id }`. El adaptador que exponga paginación HTTP valida el
esquema, la codificación y el ámbito del cursor de O01 antes de construir esa
frontera. PostgreSQL conserva la precisión de microsegundos en la comparación.
Las fechas se refieren a la creación del recurso para hijos y a la creación de
la concesión para compartidos.

En el adaptador HTTP se ejecuta primero `requireAuth` de O04. Luego el caso de
uso evalúa la acción con el servicio. Para escrituras, se construye el servicio
con el cliente de la misma transacción y se sigue el protocolo de bloqueo del
propietario antes de evaluar. El tipo de recurso, la cuota y las demás
precondiciones son responsabilidad del caso de uso.

Las rutas actuales de identidad y salud no operan sobre recursos ajenos. Los
módulos de carpetas, archivos y cargas llamarán a este servicio en sus rutas y
casos de uso. Las concesiones de raíz se ignoran y los recursos con una cadena de
propiedad inválida, cíclica, incompleta o inactiva quedan invisibles.

## Matriz de decisiones

Para un recurso activo y visible, sujeto al tipo y demás precondiciones del
caso de uso:

| Acción | Propietario | READ | EDIT | Sin acceso |
| --- | --- | --- | --- | --- |
| Consultar, listar y descargar | Sí | Sí | Sí | No |
| Renombrar y eliminar | Sí, salvo raíz | No | Sí | No |
| Administrar concesiones | Sí, salvo raíz | No | No | No |
| Crear carpeta o iniciar carga | Sí | No | No | No |

El mayor permiso entre la concesión directa y las de ancestros válidos es el
permiso efectivo. La propiedad tiene prioridad. Revocar una concesión deja
vigentes las demás. Cualquier ancestro inactivo o una cadena que no llegue a la
raíz activa del mismo propietario oculta el recurso.

## Validación de O05

Referencia: rama `feat/o05-resource-authorization`, sobre `bbcf9ec`.

En PostgreSQL 17.7 aislado de Docker, aplicar las migraciones con
`npm run migrate -w @drive-clone/server`. Configurar `DATABASE_URL` hacia esa
base de pruebas y una `SESSION_SECRET` ficticia de al menos 32 caracteres.
Desde la raíz ejecutar:

```sh
npm run typecheck -w @drive-clone/server
npm run check
npm run build -w @drive-clone/web
```

Aprobaron las cuatro migraciones, los tipos del servidor, la sincronización de
contratos, las 83 pruebas y la compilación web. Las pruebas de O05 comprueban la
matriz, el permiso restante después de revocar una concesión, la visibilidad y
paginación de los listados, el árbol en eliminación y el uso de la sesión de
O04. Las pruebas HTTP de rutas de recursos definitivas corresponden a sus
respectivos módulos conforme se incorporen.

### Cobertura de la tarjeta

| Criterio | Evidencia |
| --- | --- |
| Matriz, denegación y raíz protegida | `policy.test.ts` cubre las siete acciones para propietario, READ, EDIT, usuario sin acceso y raíz. |
| Herencia, combinación y revocación | `access.integration.test.ts` verifica el permiso más alto, la vía restante tras revocar y el décimo nivel. |
| Visibilidad, relaciones y estados | La misma suite verifica recursos inexistentes, hermanos y ancestros privados, propiedad coherente en PostgreSQL, archivos reservados y un ancestro en eliminación. |
| Consistencia de consultas y listados | La consulta compartida resuelve los permisos. Las pruebas verifican entradas directas, hijos, ausencia de datos del padre y el cursor con microsegundos. |
| Identidad y control en servidor | `http.test.ts` cubre 401, 403 y 404. `http.integration.test.ts` verifica la sesión de O04 y una lectura autorizada con PostgreSQL. |
| Aplicación en rutas definitivas | Las rutas de archivos, carpetas y cargas conectarán la política en sus propias tareas. La publicación efectiva de una carga requiere reevaluar CREATE_CHILD dentro de la transacción correspondiente. |
