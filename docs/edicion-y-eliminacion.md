# Renombrado y eliminación de recursos

| Operación                                            | Comportamiento                                                                                                                                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH /api/v1/resources/:id`                        | Recibe el nombre y devuelve el recurso actualizado. Conserva identificador, contenido y permisos. Los archivos mantienen su extensión y la respuesta de un editor omite el padre privado.                  |
| `DELETE /api/v1/resources/:id?confirmRecursive=true` | Registra la eliminación y devuelve `202` con identificador, estado e impacto. Mientras el recurso siga en eliminación, el solicitante o propietario puede repetir la solicitud y recibir el mismo trabajo. |
| `GET /api/v1/deletions/:id`                          | El propietario y el solicitante pueden consultar estado y progreso, incluso tras retirar los metadatos del recurso.                                                                                        |

El renombrado aplica NFC, recorte, límites de longitud y unicidad entre
hermanos. Propiedad y EDIT permiten ambas operaciones. READ recibe 403 y un
recurso no visible devuelve 404. La raíz se protege y las mutaciones requieren
sesión, origen válido y CSRF.

## Borrado y recuperación

La API bloquea la fila del propietario, reevalúa la autorización y marca el
subárbol como `DELETING`. Retira las concesiones, solicita la cancelación de
cargas pendientes y guarda el trabajo y el evento Outbox en una transacción.
Un borrado superpuesto por debajo del objetivo devuelve conflicto. El diálogo
avisa que se elimina la carpeta con sus descendientes o el archivo y, si el
actor es editor, identifica el efecto sobre el recurso ajeno.

El consumidor adquiere un lease de 60 segundos y espera que las cargas
afectadas queden terminales y sin limpieza pendiente. Borra los objetos y
las claves de los intentos en lotes. Después, bajo el bloqueo del propietario,
retira las hojas del árbol y registra progreso y cuota en PostgreSQL. Las
llamadas S3 se hacen fuera de transacciones SQL. Repetir un mensaje o un lote
es seguro porque las claves están ligadas a identificadores de archivo e
intento y el progreso solo avanza por metadatos retirados en la transacción.

Las fallas se reintentan en 5 y 20 segundos. Al agotar tres intentos el
estado es `FAILED`, con el inventario pendiente y el recurso inaccesible.
El reconciliador reactiva mensajes perdidos y trabajos elegibles con lease
vencido. Para una recuperación supervisada, identificar el trabajo por su ID,
corregir la dependencia, registrar el incidente y llamar
`resumeFailedDeletion(id)` desde un entorno operativo autorizado. Esta
función conserva el progreso, reactiva Outbox y devuelve si reprogramó el
trabajo. La recuperación no se expone por HTTP.

## Cómo verificar

Con tres cuentas, crear una carpeta con subcarpeta y un archivo. Compartir la
carpeta con READ y EDIT. Desde la cuenta EDIT, renombrar el archivo y descargarlo
para comparar sus bytes. Iniciar y confirmar el borrado de la carpeta, comprobar
que la cuenta READ pierde acceso y esperar que el trabajo muestre todos los
recursos procesados.

## Evidencia de O12

Validación local sobre `4bfc8e5` más los cambios de la rama
`feat/o12-resource-editing`. PostgreSQL 17 y LocalStack 4.10 fueron
contenedores aislados. Migraciones y bootstrap se ejecutaron contra ese
entorno.

| Verificación                                                                                                                                                                                | Resultado                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run check`                                                                                                                                                                             | 128 pruebas aprobadas y 57 omitidas por condiciones de integración. Formato, lint, tipos, contratos y límite de líneas aprobados.                                                                      |
| `npm run build`                                                                                                                                                                             | Aprobado con advertencias de dependencias de Vite.                                                                                                                                                     |
| `RUN_FILES_INTEGRATION=true RUN_DELETION_INTEGRATION=true npx vitest run apps/server/src/modules/editing apps/server/src/modules/deletions apps/web/src/pages/ResourceEditActions.test.tsx` | Ocho pruebas aprobadas con PostgreSQL y LocalStack. Incluye fallos de S3, reversión SQL tras retirar un objeto, recuperación de lease, repetición y bloqueo de publicación de una carga activa.        |
| `RUN_FILES_INTEGRATION=true RUN_UPLOAD_INTEGRATION=true npm run test:integration`                                                                                                           | 52 pruebas aprobadas y 38 omitidas con el trabajador activo, antes de añadir la última prueba de recuperación de lease.                                                                                |
| Chrome con tres cuentas y concesiones O11                                                                                                                                                   | La cuenta READ pudo navegar, el editor renombró un archivo y descargó bytes idénticos. El borrado recursivo concluyó por SQS con tres recursos procesados y retiró el acceso a propietario y receptor. |

El procedimiento aislado del repositorio ejecuta las pruebas que fuerzan fallos
y estados de procesamiento después de detener el trabajador, para controlar el
orden de esos escenarios.

Una ejecución conjunta sobre la base reutilizada produjo dos tiempos de espera
y una aserción fallida de Outbox. El publicador tenía eventos pendientes de
otros escenarios. Se repitieron las regresiones y los escenarios de borrado por
separado sobre PostgreSQL limpio, sin trabajador activo. Con
`RUN_UPLOAD_FAILURES=true npm run test:integration -- --maxWorkers=1` pasaron
42 pruebas y se omitieron 49. A continuación,
`RUN_DELETION_INTEGRATION=true npx vitest run --config vitest.integration.config.ts --maxWorkers=1 apps/server/src/modules/deletions`
ejecutó las seis pruebas de borrado sin fallos ni omisiones.
