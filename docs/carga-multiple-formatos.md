# O09 — Carga múltiple, formatos y drag & drop

## Formatos admitidos

La extensión se compara sin distinguir mayúsculas; el MIME declarado por el navegador no es confiable. El servidor comprueba cabeceras/estructura y valida texto UTF-8 sin bytes nulos.

| Grupo      | Extensiones                                                   | Validación de contenido                                                           |
| ---------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Imágenes   | PNG, JPG, JPEG, WebP, DNG                                     | Firma PNG/JPEG, RIFF/WebP y TIFF con tag DNG                                      |
| Imagen RAW | RAW                                                           | Binario opaco: se valida nombre y tamaño, no se afirma una estructura universal   |
| Audio      | MP3, WAV, OGG, M4A, FLAC                                      | Cabecera ID3/frame, RIFF/WAVE, OggS, ISO BMFF/ftyp, fLaC                          |
| Video      | MP4, WebM, MOV                                                | ISO BMFF/ftyp, EBML/WebM, y marca de QuickTime para MOV                           |
| Documentos | PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, ODT, ODS, ODP, TXT, CSV | Firma PDF, contenedor OLE2, ZIP Office con partes internas/MIME ODF y texto UTF-8 |

No se convierten ni editan bytes. Una extensión admitida no anula la comprobación de contenido; un MIME engañoso se ignora. Contenido truncado, firma incompatible, ZIP fuera del presupuesto o texto inválido se rechazan con `415 UNSUPPORTED_FORMAT`; exceso de tamaño devuelve `413 PAYLOAD_TOO_LARGE`.

## Límites

- Servidor: 100 MiB (104857600 bytes) por reserva y recepción; cuota 1 GiB (1073741824 bytes) sumando almacenamiento y reservas; hasta 10 cargas no terminales por usuario. El bloqueo transaccional de la fila `User` serializa reservas concurrentes.
- Cliente: máximo 10 archivos por selección/arrastre y hasta 3 flujos de envío HTTP simultáneos. Formato y tamaño se anticipan en la interfaz, además de validarse en el servidor.

## Experiencia y estados

Cada archivo mantiene progreso, estado y error independiente; un error no cancela los otros archivos. La interfaz distingue “Envío HTTP completado: archivo subido y encolado” de “Almacenamiento completado: disponible en S3”. La zona de soltar tiene como alternativa un selector múltiple accesible por teclado.

Mientras haya trabajos no terminales, el cliente consulta `GET /api/v1/uploads?active=true` en una única petición agrupada, con intervalo mínimo de un segundo. La respuesta se limita al usuario autenticado e incluye trabajos terminales recientes para resolver la UI sin sondeo individual. El polling cesa al terminar o desmontarse la vista.

## Pruebas

`format-fixtures.ts` genera muestras pequeñas de las 26 extensiones; las pruebas unitarias contrastan firmas y estructura y la suite de integración sube/descarga muestras conservando los bytes.
