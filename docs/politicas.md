# Políticas compartidas v1

## Nombres y límites

Username: ASCII, 3–32 caracteres, primera letra, después letras/números/guion/guion bajo; persistir en minúsculas. Contraseña de 15–128 caracteres, sin recortar ni normalizar; Argon2id mínimo 19 MiB, dos iteraciones y paralelismo uno. Los límites de texto se cuentan por puntos de código Unicode, también en servidor.

Nombre de recurso: NFC y trim antes de validar; 1–120 caracteres, sin controles Unicode Cc, `/`, `\`, `.` ni `..`. `nameKey` = nombre normalizado convertido a minúsculas con reglas Unicode de JavaScript, sin locale; no quitar acentos. La misma función compartida se aplicará antes de validar/persistir. Nunca usar nombres visibles como rutas o claves S3. Archivo y carpeta compiten por el mismo nombre entre hermanos. Máximo diez niveles bajo raíz (raíz profundidad 0). No hay movimientos ni ciclos.

## Autorización común

| Operación | Propietario | READ efectivo | EDIT efectivo |
| --- | --- | --- | --- |
| Consultar, listar, descargar archivo | Sí | Sí | Sí |
| Renombrar y eliminar | Sí | No | Sí |
| Compartir, listar concesiones, cambiar permiso, revocar | Sí | No | No |
| Crear/subir en carpeta | Sí | No | No |

Puerto interno común: `ResourceAuthorization.evaluate({actorId,resourceId,action})` devuelve Promise de `{visible,allowed,effectivePermission}`. Actions: VIEW, LIST_CHILDREN, DOWNLOAD, RENAME, DELETE, MANAGE_SHARES, CREATE_CHILD. Invisible: false/false/null; visible: permiso OWNER/READ/EDIT y allowed según operación. Sin sesión se rechaza antes de invocarlo. El adaptador HTTP traduce invisible a 404 y visible/prohibido a 403; fallos técnicos se propagan como errores seguros, no como permiso denegado. La instancia del puerto se compone con el repositorio ligado a la transacción de la operación. El caso de uso reevalúa con el mismo contexto transaccional/bloqueo de su repositorio; una consulta previa fuera de transacción nunca autoriza una escritura posterior. El puerto es independiente de los objetos HTTP request/reply.

VIEW/ LIST_CHILDREN / DOWNLOAD corresponden a lectura (tipo de recurso se valida en el caso de uso); RENAME/DELETE a edición; MANAGE_SHARES solo propietario; CREATE_CHILD solo propietario. Protección de raíz adicional siempre, incluso para OWNER. Estas decisiones no exponen ancestros a consumidores HTTP.

Máximo permiso entre concesiones directas y ancestros activos; EDIT supera READ. Sin DENY. Herencia en descendientes presentes y futuros. Revocar elimina una sola vía; devolver permiso restante y advertirlo. Un receptor nunca ve ancestros ni hermanos privados. `/shared` muestra puntos de entrada directos, no cada descendiente. No se comparte, renombra ni elimina raíz. No conceder a sí mismo: 409 STATE_CONFLICT. Usuario destino inexistente: 404 RESOURCE_UNAVAILABLE sin enumeración adicional.

Autorización por operación y consulta de pertenencia dentro de transacciones relevantes. Recursos invisibles/inexistentes: 404; visibles pero acción prohibida: 403. Sin sesión: 401. Cargas solo consultables/cancelables por su usuario; borrados por solicitante y propietario. Los permisos se comprueban al iniciar la descarga. La revocación afecta a nuevas solicitudes; los datos descargados y las transmisiones ya autorizadas quedan fuera de ese control.

## Archivos

Extensiones admitidas: png, jpg, jpeg, webp, raw, dng; mp3, wav, ogg, m4a, flac; mp4, webm, mov; pdf, doc, docx, ppt, pptx, xls, xlsx, odt, ods, odp, txt y csv. Comparar extensión sin distinguir mayúsculas. El nombre debe incluir una extensión admitida; un renombrado de archivo conserva la extensión validada (comparación insensible a mayúsculas), 400 INVALID_INPUT en otro caso. No convertir contenidos.

Validar extensión y firma/estructura reconocible, nunca confiar en MIME declarado. RAW es binario opaco y no acredita autenticidad. Office/ODF ZIP: inspección acotada sin extracción al disco. TXT/CSV nunca se interpretan como HTML. Rechazar ejecutables/HTML identificados, incluso renombrados. La validación de formatos no incluye análisis antimalware.

| Límite inicial configurable | Valor |
| --- | --- |
| Archivo y reserva exacta | 100 MiB = 104857600 bytes; cero bytes solo para TXT/CSV |
| Selección y envíos del navegador | Diez archivos; tres envíos simultáneos |
| Cargas no terminales por usuario | Diez, incluidas CANCEL_REQUESTED, control atómico |
| Cuota incluyendo reservas | 1 GiB = 1073741824 bytes |
| Recepción | Diez minutos; CREATED expira a los quince minutos |
| Listado | 25 por defecto, máximo 100 |
| Consulta agrupada | Una petición/segundo por usuario como máximo |
| Inspección ZIP | Máximo 1000 entradas, 1 MiB de metadatos leídos, 10 MiB de contenido inspeccionado y ratio declarado 100:1 |

Los límites ZIP son un presupuesto de inspección, no autorización para descomprimir documentos enteros. Estructuras truncadas, cifradas o fuera del presupuesto: 415 UNSUPPORTED_FORMAT. El adaptador de validación deberá comprobar firmas y marcadores propios (OOXML: `[Content_Types].xml` y `word/`, `ppt/` o `xl/`; ODF: `mimetype` coherente). Los detalles de bibliotecas y fixtures pertenecen a O09, conservando estos resultados externos.

El tamaño recibido debe coincidir con la reserva. Exceso: 413 y fallo de recepción; defecto: 400 y FAILED. Límite de cuota: 409 QUOTA_EXCEEDED; cargas activas: 429 RATE_LIMITED. Liberar reserva solo al confirmar limpieza/borrado. Ajustar límites requiere actualizar esquema configurable, documentación y pruebas antes de habilitarlo; la versión inicial publica estos máximos.

## Seguridad y experiencia

Cookie `drive_session`, HttpOnly, SameSite=Lax, Path=/api/v1, sin Domain; Secure bajo HTTPS. Absoluta ocho horas, inactividad treinta minutos. Regenerar al autenticar, invalidar al salir y limpiar expiradas. GET CSRF crea sesión previa; enviar `x-csrf-token` y comprobar Origin esperado en toda mutación, incluido registro/login. Sin token en localStorage; nunca devolver contraseña, hash, clave S3, temporal, secreto o datos internos.

Un origen por NGINX, helmet, rate limiting: login 10/minuto/IP, registro 5/hora/IP, API 120/minuto/usuario; límites adicionales de consulta de cargas. Contadores locales de API única, sin afirmar distribución. Proxy de contenido sin buffering y con tamaños/timeouts alineados. Descarga streaming, attachment, nosniff, private/no-store. JSON privado y token CSRF también no-store.

Logs en español: requestId, operación, resultado y uploadId cuando corresponda; excluir cookies, tokens, contraseñas, contenidos y nombres sensibles innecesarios. Contenedores no root, sin socket Docker, secretos por entorno y solo volúmenes necesarios. HTTPS al presentar desde otra red/equipo; HTTP únicamente loopback local.

Interfaz navegable por teclado, etiquetas accesibles, foco visible, progreso y errores claros. Selector múltiple y zona drag & drop equivalentes. Consulta agrupada se detiene al terminar, cerrar sesión o desmontar; abortar envío debe acompañarse de solicitud persistida de cancelación. Borrar requiere resumen del subárbol antes de confirmar y advertencia de que un editor elimina recursos del propietario. El cliente obtiene el resumen recorriendo listados autorizados; servidor calcula impacto definitivo al bloquear, que puede diferir por concurrencia.
