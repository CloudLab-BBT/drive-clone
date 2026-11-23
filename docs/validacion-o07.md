# Validación de O07

Fecha: 2026-11-23. Proyecto Compose aislado `drive-clone-o07-test`, con volúmenes propios de PostgreSQL 17 y LocalStack Student. Rama `feat/o07-listar-descargar-archivos` creada desde `main` después de integrar O06.

## Pruebas ejecutadas

| Comando o procedimiento | Resultado |
| --- | --- |
| `docker compose -p drive-clone-o07-test up -d --build worker web` | PostgreSQL, LocalStack, API y trabajador saludables; web disponible en `127.0.0.1:8080`. El primer arranque detectó sintaxis TypeScript no admitida por Node; se corrigió el constructor y el segundo arranque pasó. |
| `docker compose -p drive-clone-o07-test run --rm -e RUN_FILES_INTEGRATION=true -e LOG_LEVEL=silent api npx vitest run apps/server/src/modules/files/files.integration.test.ts --maxWorkers=1 --fileParallelism=false --testTimeout=45000` | Integración real PostgreSQL/S3: listado vacío y 27 archivos en 3 páginas sin omisiones ni duplicados; límites 25/100 y rechazo de 101; cursor inválido; estados no disponibles; sesión y terceros; descarga READ/EDIT con bytes iguales; objeto ausente, fallo S3 simulado y ancestro en eliminación. |
| `npx vitest run apps/server/src/modules/files/cursor.test.ts apps/web/src/pages/FileList.test.tsx` | Cursor, estado vacío, paginación y descarga de la interfaz aprobados. |
| `npm run typecheck` y `npm run build -w @drive-clone/web` | Tipos y build web aprobados. |
| `docker compose -p drive-clone-o07-test run --rm -e LOG_LEVEL=silent api npm run check` | Tipos, contratos y suite del contenedor: 80 pruebas aprobadas; 9 integraciones opcionales omitidas por defecto. La integración O07 se ejecutó por separado arriba; las pruebas web se ejecutaron localmente. |

## Recorrido desde navegador

Con Playwright CLI se registró una cuenta de prueba en `http://127.0.0.1:8080`, se subió `o07-browser-2311.pdf`, se esperó **Archivo disponible**, se pulsó **Actualizar** en **Mis archivos** y se descargó por la interfaz. El nombre sugerido fue `o07-browser-2311.pdf`; SHA-256 original y descargado: `7FD1170F8C3938F53327C7022E581FAA5335CEC24952140B82F4E184E01DCC0E`.

## Pendiente

Repetir la concesión READ/EDIT mediante los endpoints completos de O11 cuando estén disponibles; esta validación creó concesiones directamente en PostgreSQL para ejercitar la política O05. No se probó un corte de S3 después de empezar a transmitir bytes: el fallo previo al envío devuelve 503 y el fallo posterior interrumpe el stream. La descarga de carpetas, enlaces públicos y previsualización quedan fuera de O07.
