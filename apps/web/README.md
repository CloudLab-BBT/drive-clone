# Web O02

`src/main.tsx` monta una pantalla inicial React. No ofrece todavía autenticación ni carga de archivos. Vite compila los archivos estáticos para NGINX; `infra/nginx.conf` reenvía `/api/` al servicio interno.

## Creación y navegación de carpetas

- `FileList({ rootId, title, manageFolders })` mantiene la ruta visitada a partir
  de los resultados autorizados y ofrece retorno a la raíz. En la unidad propia
  muestra la creación de carpetas y el selector de carga para la ubicación actual.
- `useFilePage(endpoint)` consulta y pagina la ubicación. Devuelve los datos y
  acciones de actualización y paginación, y descarta respuestas de vistas anteriores.
- `FolderForm({ parentId, onCreated })` envía el nombre a la API con sesión y CSRF.
  Notifica el éxito para refrescar el listado y muestra el mensaje de error de la API.
- `UploadWidget({ parentId, onCompleted })` reserva el lote en el destino
  seleccionado y avisa cuando hay archivos publicados. Mantiene el progreso de las
  cargas al cambiar de carpeta.
- `download(file)` recibe el identificador y nombre de un archivo y solicita la
  descarga con la sesión vigente.
- `folder-navigation.test.tsx` comprueba navegación, creación y destino de la carga
  en la interfaz, con respuestas simuladas.

## Compartición de recursos

- `ShareAction({ resource })` abre el diálogo de concesiones para el recurso
  propio identificado por su ID y nombre. Usa el foco y cierre del diálogo
  nativo y devuelve el foco al botón al cerrar.
- `useShares(resourceId)` obtiene las concesiones directas y devuelve los
  estados del panel y las acciones de guardar, revocar y paginar. Usa el
  cliente HTTP con sesión y CSRF. Informa si queda un permiso heredado.
- `ShareAction.test.tsx` verifica la apertura por teclado, el cambio de
  permiso y el aviso al revocar una concesión con acceso heredado.
