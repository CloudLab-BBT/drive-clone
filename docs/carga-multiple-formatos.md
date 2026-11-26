# O09 — Carga múltiple, formatos y drag & drop

## Formatos admitidos

La extensión se compara sin distinguir mayúsculas; el MIME declarado por el navegador no es confiable. El servidor comprueba cabeceras y estructura interna, y valida texto como UTF-8 estricto sin bytes nulos. No se convierte ni edita el contenido.

| Grupo      | Extensiones                                                   | Validación de contenido                                                           |
| ---------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Imágenes   | PNG, JPG, JPEG, WebP, DNG                                     | Firma PNG/JPEG, RIFF/WebP y TIFF con tag DNG                                      |
| Imagen RAW | RAW                                                           | Binario opaco: se valida nombre y tamaño, no se afirma una estructura universal   |
| Audio      | MP3, WAV, OGG, M4A, FLAC                                      | Cabecera ID3/frame, RIFF/WAVE, OggS, ISO BMFF/ftyp, fLaC                          |
| Video      | MP4, WebM, MOV                                                | ISO BMFF/ftyp, EBML/WebM, y marca de QuickTime para MOV                           |
| Documentos | PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, ODT, ODS, ODP, TXT, CSV | Firma PDF, contenedor OLE2, ZIP Office con partes internas/MIME ODF y texto UTF-8 |

Una extensión admitida no anula la comprobación de contenido; un MIME engañoso se ignora. Contenido truncado, firma incompatible, ZIP fuera del presupuesto o texto inválido se rechazan con HTTP `415` y código `UNSUPPORTED_FORMAT`; exceso de tamaño devuelve `413 PAYLOAD_TOO_LARGE`. `.raw` se acepta como binario opaco según extensión y tamaño, sin afirmar una validación universal de su estructura.

Los contenedores ZIP Office/ODF limitan el directorio central a 1000 entradas y 1 MiB, el contenido descomprimido agregado a 10 MiB, los metadatos inspeccionados a 1 MiB y la profundidad de ruta a 10 componentes. Se rechazan rutas inseguras, estructura interna inválida, entradas cifradas (bits 0, 6 o 13 del general-purpose flag), tamaños declarados inconsistentes y relaciones de compresión superiores a `100:1`. Todas estas infracciones responden `415 UNSUPPORTED_FORMAT`.

## Límites

- Servidor: 100 MiB (104857600 bytes) por reserva y recepción; cuota 1 GiB (1073741824 bytes) sumando almacenamiento y reservas; hasta 10 cargas no terminales por usuario. El bloqueo transaccional de la fila `User` serializa reservas concurrentes.
- Cliente: máximo 10 archivos por selección/arrastre y hasta 3 flujos de envío HTTP simultáneos. Formato y tamaño se anticipan en la interfaz, además de validarse en el servidor.

## Experiencia y estados

Cada archivo mantiene progreso, estado y error independiente; un error no cancela los otros archivos. La interfaz distingue “Envío HTTP completado: archivo subido y encolado” de “Almacenamiento completado: disponible en S3”. La zona de soltar tiene como alternativa un selector múltiple accesible por teclado.

El servidor limita cada carga a 10 elementos no terminales del usuario autenticado, ordenados por fecha de creación e ID; excluye `COMPLETED`, `FAILED` y `CANCELLED`. `GET /api/v1/uploads/:id` devuelve el estado actual solo al propietario. El cliente consulta `GET /api/v1/uploads?active=true` en una única petición agrupada, con al menos un segundo entre inicios y sin solapar solicitudes; si un ID seguido desaparece del grupo (incluido por el límite de 10), consulta su estado por ID. El polling cesa cuando todo termina o al desmontar la vista.

Las respuestas se fusionan de forma monotónica: `QUEUED` no reemplaza `PROCESSING`, `CANCEL_REQUESTED` ni un estado terminal; los terminales conservan precedencia. Si el servidor ya avanzó una carga cuando llega el `PUT`, no la vuelve a `QUEUED` y responde conflicto de estado.

## Evidencia de revisión PR #13

Las muestras multimedia pequeñas se generaron con FFmpeg 7.1 y decodifican sin error. DOC/DOCX, PPT/PPTX, XLS/XLSX, ODT/ODS/ODP y PDF son documentos de muestra exportados por LibreOffice 26.8.2.2 y abiertos de nuevo mediante conversión a PDF. DNG es una imagen TIFF Bayer de 16×16 con metadatos DNG reconocidos por ExifTool; RAW mantiene deliberadamente un fixture opaco. Todos los bytes de las 26 muestras completaron la carga, procesamiento en worker, almacenamiento S3 y descarga sin cambios.

**Revisión probada:** rama `feat/o09-carga-multiple-drag-drop`, HEAD base `c8d250f7338a1f584c6af3ccd345ed76c40fc5b1`. Las pruebas cubrieron ese HEAD más los cambios locales; todavía no hay un commit nuevo que contenga este parche.

**Comandos y resultados:**

| Comando                                                                                                                                                  | Resultado                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run contracts:check`, `npm run check:file-lines`, `npm run build`, `npm run test:unit` | Todo correcto en `node:24.21.0-bookworm-slim`; 22 archivos unitarios y 83 pruebas aprobadas. `format:check`/`check:file-lines` usaron un shim temporal de Git porque la imagen slim no incluye Git.                                                                                                                           |
| `./scripts/test-integration-isolated.sh`                                                                                                                 | Correcto con PostgreSQL, LocalStack S3/SQS y worker en contenedores efímeros; incluyó migración/bootstrap, lint, tipos, contratos y suites completas.                                                                                                                                                                         |
| `npm test` dentro del script aislado                                                                                                                     | 32 archivos y 109 pruebas aprobadas; 12 archivos/23 pruebas de integración omitidas en el modo sin servicios.                                                                                                                                                                                                                 |
| `npm run test:integration` dentro del script aislado                                                                                                     | 18 archivos y 41 pruebas aprobadas (8 omitidas); 14 archivos y 34 pruebas aprobadas (15 omitidas) en el grupo de fallos. Incluye round-trip byte a byte de los 26 formatos, rechazo de MIME/extensión engañosos, pruebas de polling/cuotas, PUT monotónico y HTTP `415 UNSUPPORTED_FORMAT` para ZIP cifrado y ratio `>100:1`. |
| Gitleaks v8.24.2: `git` y `dir` con `--redact --config=/repo/.gitleaks.toml`                                                                             | 0 hallazgos en historial (35 commits, 3.65 MB) y árbol de trabajo (2.37 MB).                                                                                                                                                                                                                                                  |
| FFmpeg 7.1 y ExifTool                                                                                                                                    | Decodificación de fixtures de imagen/audio/video correcta; DNG validado sin advertencias.                                                                                                                                                                                                                                     |

El escaneo de árbol se realizó con el subcomando `gitleaks dir`, que no recorre historial Git. Queda pendiente el resultado de CI remoto tras actualizar la PR.
