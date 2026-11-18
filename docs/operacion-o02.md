# Operación del entorno O02

Fecha: 2026-11-18. Alcance: base reproducible, migración, recursos S3/SQS y diagnósticos. La API de archivos, sesiones y procesamiento de trabajos pertenecen a tareas posteriores. El proceso `worker` de O02 expone salud; todavía no consume mensajes.

## Requisitos y configuración

- Docker Engine con Compose y acceso a las imágenes fijadas en `compose.yaml`.
- Acceso válido a LocalStack con S3, SQS y persistencia; token individual fuera del repositorio. Comprobar que el plan permite estos servicios y su uso en CI antes de considerarlo validado.
- Copiar `.env.docker.example` a `.env` y reemplazar la contraseña y el token. No usar el ejemplo como credencial real. El archivo `.env` está ignorado por Git.
- Se usa Node 24.21.0, PostgreSQL 17.7, NGINX 1.29.4 y LocalStack Pro 2026.3.0 con digest fijado. Las dependencias npm se fijan en `package-lock.json`. La imagen con licencia requiere un token válido; además, el plan debe habilitar persistencia.

## Arranque

```sh
docker compose up --build -d
docker compose ps
curl http://127.0.0.1:8080/api/v1/health/live
curl http://127.0.0.1:8080/api/v1/health/ready
```

`migrate`, `bootstrap` y `temp-init` son trabajos de inicialización. `migrate` aplica las migraciones SQL con Prisma 7; `bootstrap` crea o verifica el bucket, la cola y DLQ; `temp-init` prepara el volumen temporal para UID 1000. Después arrancan API, trabajador y web. Las cinco aplicaciones persistentes son web, API, trabajador, PostgreSQL y LocalStack.

El navegador usa `http://127.0.0.1:8080`. Solo ese puerto se publica en loopback. Para acceso desde otra red se requiere un terminador HTTPS y configuración explícita; este Compose no publica servicios internos.

## Servicios y datos

| Servicio | Función | Persistencia |
| --- | --- | --- |
| `web` | NGINX y React compilado; proxy `/api/` sin buffering de solicitudes | Imagen |
| `api` | HTTP y liveness/readiness | Volumen `temp_data` |
| `worker` | Proceso separado; salud de dependencias en O02 | Volumen `temp_data` |
| `postgres` | Esquema relacional | Volumen `postgres_data` |
| `localstack` | S3, SQS y DLQ | Volumen `localstack_data`, con `PERSISTENCE=1` |

Los volúmenes llevan el prefijo del proyecto Compose `drive-clone-dev`; no ejecutar `down -v` para reinicios normales. El volumen temporal es compartido por API y trabajador en un único host. No se afirma tolerancia a fallo de host ni persistencia de LocalStack hasta completar la prueba de reinicio con objeto y mensaje.

## Diagnóstico

- `/api/v1/health/live` responde si el proceso API atiende HTTP, incluso con dependencias caídas.
- `/api/v1/health/ready` devuelve 200 o 503 con resultados booleanos de PostgreSQL, bucket, cola, DLQ y temporal. Cada comprobación tiene límite de tres segundos y no devuelve credenciales ni errores internos.
- El trabajador ofrece `/health/live` y `/health/ready` en su red interna, puerto 3001. Su healthcheck Compose consulta readiness. No implica que procese cargas.
- `docker compose ps`, `docker compose logs api worker migrate bootstrap` y `docker compose run --rm migrate` ayudan a aislar fallos. El último comando reaplica migraciones pendientes de forma idempotente.
- Para comprobar permisos del temporal: `docker compose exec api node -e "require('fs').writeFileSync('/app/temp/check','ok')"` y `docker compose exec worker node -e "console.log(require('fs').readFileSync('/app/temp/check','utf8'))"`. Retirar el archivo con `docker compose exec api rm /app/temp/check`.

## Prueba de persistencia pendiente

Con token y motor disponibles, ejecutar `docker compose up --build -d` desde volúmenes vacíos y repetir el mismo comando. Verificar que las tablas, bucket, cola y DLQ existen y que la segunda ejecución no modifica ni elimina datos. Escribir un objeto de prueba y enviar un mensaje de prueba a la DLQ con identificador único; registrar bytes/hash y cuerpo/ID. Reiniciar únicamente LocalStack con `docker compose restart localstack`; recuperar el objeto, comparar el hash y recibir el mensaje. Usar un nombre de objeto y un mensaje específicos de la prueba para no interferir con cargas reales. Repetir readiness con PostgreSQL o LocalStack detenidos y restaurados; liveness debe permanecer disponible y readiness pasar de 503 a 200. Registrar salidas, plan/token disponible y compatibilidad del token CI sin incluir secretos.

## Validación pendiente

En este equipo, Docker CLI y Compose están instalados, pero el motor no responde. Tampoco se detectó `LOCALSTACK_AUTH_TOKEN` configurado. Por eso no se han ejecutado migración limpia, bootstrap real, lectura tras reinicio, cola tras reinicio, caída/recuperación de dependencias ni permisos del temporal. Deben probarse antes de aceptar O02.
