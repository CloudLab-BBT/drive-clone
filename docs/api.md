# Contrato HTTP v1

Fuente de cuerpos: TypeBox en `packages/contracts/src`; OpenAPI 3.1 en `packages/contracts/generated/openapi.json`, generado por `npm run contracts:generate`. No editar JSON generado. Prefijo `/api/v1`. Todas las operaciones están definidas en `operations.ts`; no existen endpoints ejecutándose en O01.

## Reglas de transporte

JSON de entrada cerrado (sin propiedades adicionales), UUID, timestamps RFC3339 UTC. Normalizar nombres NFC/trim y username antes de validar; contraseña no se modifica. Los esquemas no sustituyen comprobaciones transaccionales, inspección de binarios o autorización. DTO TypeScript derivados mediante `Static<typeof Schema>`; no copiar interfaces manualmente. `/auth/register` crea sesión autenticada; respuesta igual que login/me, con raíz.

Cookie `drive_session` y cabecera `x-csrf-token`. Primero GET `/auth/csrf` para sesión previa. Todas las mutaciones exigen token asociado y Origin exacto configurado; CORS no autoriza operaciones. Login/registro también requieren sesión previa. Sin sesión autenticada en operaciones privadas: 401 antes de autorización; con sesión y CSRF inválido: 403. Respuesta de login indistinguible para usuario inexistente/contraseña errónea: 401 UNAUTHENTICATED. Cambio de id de sesión al autenticar; Set-Cookie y token no se registran. Tras registro/login, obtener de nuevo CSRF para la sesión regenerada. Logout 204 sin cuerpo, invalida y elimina cookie.

GET privados y CSRF: `Cache-Control: private, no-store`; solo el frontend compilado es estático. Errores también no-store. Encabezados descargables: attachment con filename ASCII seguro y filename* UTF-8 codificado, nosniff y private/no-store. No exponer URL de S3.

## Operaciones y resultados

| Operación | Entrada | Resultado / rechazo específico |
| --- | --- | --- |
| GET /auth/csrf | Sin cuerpo | 200 csrfToken; crea sesión previa si hace falta |
| POST /auth/register | username, password | 201 user{id,username,rootId}; username ocupado 409 |
| POST /auth/login | username, password | 200 user; credenciales inválidas 401 |
| POST /auth/logout; GET /auth/me | Sesión | 204; 200 user respectivamente |
| POST /folders | parentId, name | 201 resource; ajena visible 403; profundidad/nombre 409 |
| GET /folders/:id/children | cursor?, limit? | 200 items,nextCursor; solo hijos ACTIVE; archivo como carpeta 409 |
| GET /resources/:id | id | 200 resource activo, incluyendo effectivePermission |
| PATCH /resources/:id | name | 200 resource; READ 403; raíz 403; nombre ocupado 409 |
| DELETE /resources/:id | query confirmRecursive=true | 202 deletion con impacto definitivo; requiere confirmación incluso para archivo |
| GET /shared | cursor?, limit? | 200 entradas de concesión directa activa; sin ancestros privados |
| GET /resources/:id/shares | cursor?, limit? | 200 items,nextCursor; solo propietario; concesiones directas |
| PUT /resources/:id/shares | username, permission READ/EDIT | 200 share tanto al crear como actualizar; propietario; raíz 403 |
| DELETE /resources/:id/shares/:userId | ids | 200 userId,remainingPermission; sin concesión directa, mismo resultado actual; recurso inaccesible 404 |
| POST /uploads | parentId,name,size | 201 upload CREATED y resourceId reservado; sin hacer visible Resource |
| PUT /uploads/:id/content | multipart exactamente un campo file | 202 upload QUEUED; nunca garantiza COMPLETED |
| GET /uploads?active=true | active obligatorio | 200 items de trabajos propios no terminales, máximo diez, sin paginar |
| GET /uploads/:id | id | 200 upload propio, incluido terminal y cleanupPending |
| POST /uploads/:id/cancel | Sin cuerpo | 200 upload; COMPLETED 409; repetición no duplica efectos |
| GET /files/:id/download | id archivo | 200 streaming de bytes originales; carpeta 409; no disponible 404 |
| GET /deletions/:id | id | 200 deletion solo solicitante/propietario; otros 404 |
| GET /health/live | Sin cuerpo | 200 status ok si proceso vivo; no comprueba dependencias |
| GET /health/ready | Sin cuerpo | 200 status ok o 503 status unavailable; sin diagnósticos internos |

DELETE no recibe body: confirmación en query evita incompatibilidades de intermediarios. La interfaz debe mostrar impacto usando listados y advertir que puede variar hasta el bloqueo. Deletion devuelve affectedResources calculado en la transacción y processedResources solo de recursos cuya limpieza quedó confirmada. No hay endpoint extra de previsualización.

El streaming no carga archivo completo en RAM; límite duro 100 MiB, exactamente el tamaño reservado; no usar el filename multipart para decidir nombre/ruta. Campos extra, múltiples archivos o cuerpo no multipart: 400 INVALID_INPUT (Content-Type incompatible: 415). Servidor detecta formato; MIME enviado no es autoridad. Mientras RECEIVING el cliente puede mostrar progreso local; receivedBytes persistidos no prometen actualización byte a byte. No se reanuda PUT ni se repite sobre el mismo id; tras fallo terminal y liberación de nombre/cuota, crear otra intención.

La consulta agrupada tiene límite servidor de una por segundo/usuario, además del general. Sin parámetro active=true: 400. Cliente deja de consultar cuando todos son terminales o pierde sesión. CANCEL_REQUESTED sigue activo hasta limpieza confirmada.

## Paginación

Orden ascendente estable `(createdAt,id)`; para Share el id lógico es resourceId en /shared y userId en /shares, ambos UUID únicos en el ámbito. Cursor v1 = base64url del JSON `{v:1,createdAt,id,scope}`; scope = `children:<folderId>`, `shared:<userId>` o `shares:<resourceId>`. Cadena <=512; validar estructura, timestamp y ámbito; inválido → 400 INVALID_INPUT. El cursor no concede permisos; reevaluar cada consulta. Comparar tupla estrictamente mayor, `limit+1`, devolver último elemento como nextCursor si hay más; si no, null. La paginación no usa snapshot: los cambios concurrentes pueden retirar elementos entre consultas. No incluir rutas ni datos privados en cursor.

## Errores

Cuerpo cerrado `{code,message,requestId,fields?}`; message y fields en español, sin SQL/stack/credenciales. fields solo para validación y nombres de campos públicos. requestId opaco para soporte.

| HTTP | code | Condición |
| --- | --- | --- |
| 400 | INVALID_INPUT | Esquema, nombre, cursor, tamaño menor al reservado o confirmación ausente |
| 401 | UNAUTHENTICATED | Sin sesión válida o login incorrecto |
| 403 | FORBIDDEN / CSRF_INVALID | Acción sobre visible prohibida, raíz protegida, origen/token inválido |
| 404 | RESOURCE_UNAVAILABLE | Ausente, invisible, estado no accesible o cuenta destino ausente |
| 409 | NAME_CONFLICT / USERNAME_TAKEN | Unicidad de nombre/username |
| 409 | STATE_CONFLICT / DEPTH_EXCEEDED / QUOTA_EXCEEDED | Estado incompatible, profundidad o cuota |
| 413 | PAYLOAD_TOO_LARGE | Máximo o bytes superiores a reserva |
| 415 | UNSUPPORTED_FORMAT | Extensión, firma, estructura o Content-Type no admitidos |
| 429 | RATE_LIMITED | Límite de solicitudes, polling o cargas activas; incluir Retry-After en segundos |
| 503 | DEPENDENCY_UNAVAILABLE | Dependencia necesaria caída o worker no disponible para nueva carga |
| 500 | INTERNAL_ERROR | Fallo no previsto, sin detalles internos |

Readiness 503 usa Health, excepción explícita al cuerpo de error de negocio. Worker heartbeat no mayor de 60 s para permitir nuevas cargas; registro renovado cada 20 s, O02 concretará mecanismo de persistencia y pruebas. Readiness comprueba PostgreSQL, S3/SQS, recursos provisionados y temporal con timeout de 2 s por comprobación y presupuesto total 5 s, diagnósticos solo internos. Caída S3 nunca cambia liveness.

No todas las operaciones permiten todos los errores: la lista por operación está en OpenAPI. Autorización prevalece antes de revelar conflicto de nombre o estado; operaciones sobre borrado repetido aplican excepción documentada en estados.md. No agregar endpoints sin necesidad y cambio de contrato acordado.
