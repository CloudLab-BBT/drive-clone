# Listado y descarga de archivos (O07)

## Contrato

- `GET /api/v1/folders/:id/children?cursor=&limit=` lista hijos `ACTIVE` autorizados por O05. Devuelve `items` y `nextCursor`. Incluye carpetas para navegar y archivos disponibles. Por defecto devuelve 25; admite entre 1 y 100. Un archivo usado como carpeta da `409 STATE_CONFLICT`.
- `GET /api/v1/shared?cursor=&limit=` lista concesiones directas visibles, sin añadir ancestros privados. Su cursor tiene ámbito propio por usuario.
- `GET /api/v1/files/:id/download` transmite el objeto S3 original por la API, después de evaluar `DOWNLOAD` con O05. No expone bucket ni clave. Carpetas dan `409 STATE_CONFLICT`; recursos invisibles, incompletos o en eliminación dan `404 RESOURCE_UNAVAILABLE`.

Los cursores son base64url de `{v:1,createdAt,id,scope}`. Conservan microsegundos y exigen el mismo ámbito (`children:<folderId>` o `shared:<userId>`). Cursor malformado, ámbito distinto o límite fuera de rango: `400 INVALID_INPUT`. La paginación ordena por `(createdAt,id)` y no usa snapshot entre páginas; un conjunto que cambia puede mover elementos.

## Seguridad y fallos

La autorización y la lectura de metadatos usan la misma transacción de lectura con aislamiento `REPEATABLE READ`. Solo se devuelven datos de recursos `ACTIVE`. La descarga usa `Content-Disposition: attachment` con `filename` ASCII seguro y `filename*` UTF-8, `Content-Type` persistido, `Content-Length`, `X-Content-Type-Options: nosniff` y `Cache-Control: private, no-store`. Listados y errores privados también llevan `private, no-store`.

Si falta el objeto o S3 falla antes de iniciar la respuesta, la API devuelve `503 DEPENDENCY_UNAVAILABLE` sin clave ni detalles internos y registra el diagnóstico del lado servidor. Si el stream falla después de enviar encabezados, la conexión puede interrumpirse; se registra el fallo, sin afirmar que la descarga terminó. No se implementan enlaces públicos, previsualización ni descarga de carpetas.

La interfaz muestra carpetas y archivos, estados vacíos y errores, carga más páginas y descarga con la sesión vigente mediante la API. **Actualizar** vuelve a consultar después de una carga. La descarga en el navegador crea un objeto local temporal a partir de la respuesta autorizada.

## Comparación de contenido

Con la pila Compose de pruebas, subir un archivo desde el navegador, esperar **Archivo disponible**, pulsar **Actualizar** en **Mis archivos** y luego **Descargar**. Comparar los hashes SHA-256 del archivo original y el descargado con `Get-FileHash -Algorithm SHA256 <ruta>`; ambos deben coincidir. Los comandos y resultados de esta ejecución están en `docs/validacion-o07.md`.
