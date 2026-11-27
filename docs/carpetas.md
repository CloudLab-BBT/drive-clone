# Creación y navegación de carpetas

`POST /folders` recibe `parentId` y `name` y devuelve `201 { resource }`.
El servidor verifica sesión, origen, CSRF y `CREATE_CHILD` sobre un padre activo
del propietario. Los nombres se recortan, normalizan a NFC y comparan sin
distinguir mayúsculas entre archivos y carpetas hermanas. Un duplicado devuelve
`409 NAME_CONFLICT`. La raíz tiene profundidad cero y el intento de superar el
nivel diez devuelve `409 DEPTH_EXCEEDED`.

`GET /folders/:id/children` lista de forma paginada recursos activos autorizados
en la carpeta abierta. La interfaz usa las ubicaciones visitadas para mostrar la
ruta, sin consultar nombres de ancestros privados. Las cargas conservan el
`parentId` seleccionado al iniciar el lote y el listado se actualiza tras la
publicación del archivo.

## Verificación de O08

Revisión local de `feat/o08-folder-navigation` sobre `849d506`, con los cambios
de O08 en el árbol de trabajo. Se usaron PostgreSQL 17 y LocalStack 4.10 en
contenedores aislados, con la API y el trabajador apuntando a esos servicios y
al mismo directorio temporal de pruebas.

| Procedimiento                                                                     | Resultado                                                                                                                                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run migrate` y `npm run bootstrap -w @drive-clone/server`                    | Migraciones aplicadas y bucket y colas inicializados.                                                                                                                                      |
| `npm run check`                                                                   | Formato, lint, tipos, contratos y límite de líneas aprobados. 123 pruebas aprobadas y 49 omitidas según las variables de integración.                                                      |
| `npm run build`                                                                   | Compilación aprobada. Vite mostró advertencias sobre directivas de dependencias.                                                                                                           |
| `RUN_UPLOAD_INTEGRATION=true RUN_FILES_INTEGRATION=true npm run test:integration` | 47 pruebas aprobadas y 33 omitidas. Incluye las seis pruebas de integración de O08, con transferencia vía SQS y S3, comparación de bytes, control de permisos, profundidad y concurrencia. |
| Chrome con API y PostgreSQL aislados                                              | Por teclado se crearon dos niveles, se volvió a la raíz y se comprobó que la subcarpeta seguía disponible tras recargar.                                                                   |

Para repetir el recorrido completo en el navegador, iniciar sesión, crear y abrir
una carpeta, seleccionar un archivo de prueba y esperar el estado de
almacenamiento completado. El archivo debe aparecer en esa carpeta y descargarse
desde su listado. Al volver a la raíz, el archivo debe permanecer en su ubicación.

Los permisos READ y EDIT se verificaron con concesiones preparadas en PostgreSQL.
La prueba desde la interfaz de compartición queda condicionada a O11. La prueba
de concurrencia usa un estado de eliminación válido bajo el bloqueo del dueño.
El recorrido con el trabajador de borrado se puede verificar cuando exista O12.
