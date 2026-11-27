# Compartición y revocación

| Operación                                     | Entrada y resultado                                                                                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/resources/:id/shares`            | Cursor y límite opcionales. Devuelve concesiones directas paginadas, con permiso directo y efectivo para cada receptor.                                        |
| `PUT /api/v1/resources/:id/shares`            | Recibe `username` y `permission`, recorta y normaliza el nombre de usuario y devuelve la concesión guardada. Repetir la solicitud conserva una sola concesión. |
| `DELETE /api/v1/resources/:id/shares/:userId` | Quita la concesión directa y devuelve `remainingPermission`. Repetir la revocación devuelve el acceso que exista en ese momento.                               |
| `GET /api/v1/shared`                          | Lista las entradas compartidas directamente con la cuenta activa y omite la ubicación privada.                                                                 |

Las mutaciones requieren sesión, origen válido y CSRF. Solo el propietario
administra las concesiones de recursos visibles, fuera de la raíz. Las
operaciones toman el bloqueo de la fila del propietario usado por las
mutaciones del árbol. Un destino en eliminación o con un ancestro en
eliminación queda fuera de la política de visibilidad.

| Acción                     | Propietario | READ | EDIT |
| -------------------------- | ----------- | ---- | ---- |
| Ver, navegar y descargar   | Sí          | Sí   | Sí   |
| Renombrar y eliminar (O12) | Sí          | No   | Sí   |
| Administrar concesiones    | Sí          | No   | No   |
| Crear carpetas o cargar    | Sí          | No   | No   |

La raíz permanece protegida. Al compartir una carpeta, los descendientes
actuales y futuros heredan el permiso. El mayor permiso directo o heredado
determina el acceso. La revocación se aplica a solicitudes posteriores y el
diálogo indica si se conserva acceso por otra vía. Una descarga ya autorizada
puede haber transmitido datos antes de la revocación.

## Cómo verificar

Con tres cuentas de prueba, crear una carpeta privada y una subcarpeta.
Compartir solo la subcarpeta con la segunda cuenta. Comprobar que aparece en
«Compartidos conmigo», que se puede navegar sin mostrar la carpeta privada y
que la tercera cuenta sigue sin acceso. Cambiar READ a EDIT y revocar desde
el diálogo del propietario. Actualizar el listado con la segunda cuenta para
verificar la revocación.

## Evidencia de validación

Rama local `feat/o11-resource-sharing`, basada en `32c0165` con los cambios de
O11 en el árbol de trabajo. Pruebas con PostgreSQL 17 y LocalStack 4.10 en
contenedores aislados. Se aplicaron las migraciones existentes e inicializaron
el bucket y las colas.

| Procedimiento                                                                                                       | Resultado                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                                                                     | 127 pruebas aprobadas y 50 omitidas por condiciones de integración. Formato, tipos, lint, contratos y límite de líneas aprobados.                                                                                                                                          |
| `npm run build`                                                                                                     | Aprobado, con advertencias de dependencias de Vite.                                                                                                                                                                                                                        |
| `RUN_FILES_INTEGRATION=true npx vitest run apps/server/src/modules/sharing apps/web/src/pages/ShareAction.test.tsx` | Cinco pruebas de O11 aprobadas. Incluye descarga desde S3 con READ y EDIT y rechazo después de revocar el acceso.                                                                                                                                                          |
| `RUN_FILES_INTEGRATION=true RUN_UPLOAD_INTEGRATION=true npm run test:integration`                                   | 51 pruebas aprobadas y 33 omitidas con el trabajador activo.                                                                                                                                                                                                               |
| Recorrido en Chrome con tres cuentas sintéticas                                                                     | Apertura por teclado, concesión, cambio a EDIT, cierre por Escape y retorno del foco, navegación sin ancestros privados, aislamiento de la tercera cuenta y revocación aprobados. El límite de registro se elevó solo en la instancia de prueba para repetir el recorrido. |

Las decisiones de renombrar y eliminar se comprobaron mediante la política
común. Queda para O12 probar las operaciones desde su interfaz y repetir la
concurrencia con el borrado real. O11 comprueba el bloqueo y rechazo de la
concesión con un estado de eliminación preparado en PostgreSQL.
