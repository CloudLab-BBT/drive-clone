# Controles de calidad (O03)

## Entorno local

Se requiere Docker y Docker Compose v2; las herramientas Node se ejecutan con
`node:24.21.0-bookworm-slim`. No hace falta Node instalado en el anfitrión.
`npm ci` instala las dependencias fijadas por `package-lock.json`. Los valores
locales de `.env.docker.example` son marcadores, no secretos: use valores
aleatorios solo para entornos persistentes. Las pruebas aisladas usan una clave
efímera y no requieren `.env`, LocalStack ni servicios de desarrollo.

La rama O03 integra O06 desde `main`; `package.json` y `package-lock.json`
incluyen sus dependencias, incluida `@fastify/multipart`. Se validó `npm ci`
desde una instalación limpia en el contenedor Node 24: instaló 451 paquetes
sin errores. npm informó 3 vulnerabilidades altas en la auditoría informativa
de dependencias.

Para instalar y ejecutar los controles de código en el contenedor Node:

```sh
docker run --rm -v "$PWD:/app" -w /app node:24.21.0-bookworm-slim sh -c '
  apt-get update -qq && apt-get install -y -qq git &&
  git config --global --add safe.directory /app &&
  npm ci &&
  npm run format:check &&
  npm run lint &&
  npm run typecheck &&
  npm run contracts:check &&
  npm run check:file-lines
'
```

`format:check` evalúa los archivos cambiados respecto de `BASE_REF` (o `HEAD`
localmente). Comprueba con Prettier los archivos fuente, configuración y
documentación compatibles, y valida la sintaxis de scripts shell con `sh -n`.
Omite solo archivos heredados que ya existían en la base: `apps/server/src/app.ts`,
`apps/server/src/modules/files/`, `apps/web/src/pages/` y `packages/contracts/`.
También deja fuera `docs/decisiones.md`, documento histórico no controlado por
O03. Los archivos nuevos, incluso bajo las rutas heredadas, siguen siendo
comprobados.

| Controles locales                                                                                                                                                                                                                                                                       | GitHub Actions                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `format:check`, `lint`, `typecheck`, `contracts:check` y `check:file-lines`, en el contenedor Node 24.                                                                                                                                                                                  | Mismos controles en el job `quality`, sin secretos.                                       |
| `npm run test:coverage` ejecuta pruebas unitarias y escribe cobertura.                                                                                                                                                                                                                  | Job `unit`, sube `reports/` como artefacto.                                               |
| `./scripts/test-integration-isolated.sh` hace `npm ci`, migra PostgreSQL efímero, ejecuta `npm run check` y genera JUnit de integración. El PostgreSQL usa `--tmpfs /var/lib/postgresql/data`; el `trap EXIT` hace `docker rm -fv` y elimina solo su contenedor/red `drive-clone-ci-*`. | Job `integration` ejecuta el mismo flujo aislado y publica sus reportes.                  |
| `npm run build` genera Prisma y construye el frontend; `docker compose build` construye imágenes localmente, sin publicarlas.                                                                                                                                                           | Job `build-and-scan` compila y construye las imágenes, sin publicar ni desplegar.         |
| `npm run audit:dependencies` guarda el resultado JSON de `npm audit`.                                                                                                                                                                                                                   | Job `build-and-scan` audita dependencias, filesystem, imágenes y secretos; sube reportes. |

Para compilación e imágenes locales, exporte placeholders antes de Compose:

```sh
docker run --rm -v "$PWD:/app" -w /app node:24.21.0-bookworm-slim sh -c 'npm ci && npm run build'
export POSTGRES_PASSWORD=local-placeholder-password
export SESSION_SECRET=local-placeholder-session-secret-at-least-32-chars
export LOCALSTACK_AUTH_TOKEN=local-placeholder-token
docker compose build
```

`docker compose build` solo construye imágenes; no inicia servicios, crea
volúmenes ni publica imágenes. La definición de LocalStack de `compose.yaml`
permanece sin cambios. Para ejecutar el aislamiento, el anfitrión sí necesita
Docker, porque el script crea y elimina sus propios recursos nombrados
`drive-clone-ci-*` mediante `trap`.

## Cobertura y seguridad

Vitest usa `@vitest/coverage-v8` y `all: true`, con inclusión explícita de
`apps/server/src`, `apps/web/src` y `packages/contracts/src`; se excluyen pruebas
y código Prisma generado. Los archivos fuente no ejecutados aparecen en el
reporte como no cubiertos. `npm run test:coverage` escribe texto en consola y
formatos HTML, JSON detallado/resumen y LCOV en `reports/coverage/`.

La siguiente línea base se midió con `npm run test:coverage` después de integrar
O06. Vitest tiene `all: true`, así que incluye módulos fuente sin pruebas y
refleja el estado real de cobertura, no solo el código ejecutado.

| Métrica   | Línea base O03 + O06 | Meta de referencia |    Diferencia para alcanzar meta |
| --------- | -------------------: | -----------------: | -------------------------------: |
| Líneas    |               34,47% |                85% | Faltan 50,53 puntos porcentuales |
| Funciones |               39,80% |                85% | Faltan 45,20 puntos porcentuales |
| Ramas     |               29,41% |                80% | Faltan 50,59 puntos porcentuales |

Las tres metas todavía no se alcanzan. Son objetivos de referencia ajustables
si el docente establece una exigencia superior, no umbrales impuestos sobre
módulos futuros aún sin implementar. Las pruebas deben cubrir especialmente
decisiones críticas de permisos, raíz protegida, autenticación y estados
terminales.

Los reportes de auditoría de dependencias, Trivy filesystem e imágenes y
Gitleaks se almacenan bajo `reports/` y se ignoran en Git. `npm run audit:dependencies` conserva todas las severidades en su JSON y falla
ante vulnerabilidades críticas; los hallazgos de otras severidades también
quedan visibles para remediación. Trivy se ejecuta en contenedor, por
ejemplo:

```sh
mkdir -p reports
docker run --rm -v "$PWD:/repo" aquasec/trivy:0.59.1 fs --skip-dirs /repo/reports --format json \
  --output /repo/reports/trivy-filesystem.json /repo
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$PWD/reports:/reports" aquasec/trivy:0.59.1 image --format json \
  --output /reports/trivy-drive-clone-dev-api.json drive-clone-dev-api
docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.24.2 \
  detect --config=/repo/.gitleaks.toml --source=/repo --report-format=json \
  --report-path=/repo/reports/gitleaks-history.json --redact
docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.24.2 \
  dir /repo --config=/repo/.gitleaks.toml --report-format=json \
  --report-path=/repo/reports/gitleaks-working-tree.json --redact
```

La detección Gitleaks separa historial Git y árbol de trabajo. Su checkout usa
`fetch-depth: 0` para analizar el historial completo; los reportes de ambos
escaneos usan `--redact`. El pipeline fija las acciones externas por SHA
completo de 40 caracteres, limita permisos a `contents: read` y no entrega
secretos a los jobs que ejecutan código de PR.
La allowlist global solo excluye `.env` local y reportes generados. Las fixtures
`generic-api-key` se permiten mediante combinaciones AND de ruta y commit
concretos; para el escaneo del árbol de trabajo, dos reglas acotan adicionalmente
la ruta y estructura del call site. No se almacenan valores de credenciales ni
tokens en `.gitleaks.toml`.

El escaneo inicial reportó tres coincidencias en pruebas; al retirar una
allowlist global de fixture se revelaron seis coincidencias históricas
adicionales en pruebas O04. Todas fueron verificadas como datos sintéticos de
prueba y quedaron permitidas solo en sus rutas/commits/regla. Dos call sites
sintéticos vigentes usan excepciones adicionales por regla, ruta y estructura
del código, sin valores de credenciales. La validación redactada en Docker
recorrió 27 commits y terminó con cero hallazgos; el escaneo redactado del árbol
de trabajo también terminó limpio.

## LocalStack Pro y GitHub Actions

El job aislado `localstack-pro` valida la imagen acordada en O02:
`localstack/localstack-pro:2026.3.0@sha256:4a8632f0de3888e594ff8f2d9c6e8371309ccf19469c317a9b5a074b6334c31c`.
Solo se ejecuta en `push`, `workflow_dispatch` o PR del mismo repositorio; no
se ejecuta en PRs externos no confiables. El secreto
`LOCALSTACK_AUTH_TOKEN` se entrega al contenedor solo como variable de entorno,
nunca se imprime, y el job informa si falta, si hay bloqueo de acceso/licencia
o si `/_localstack/health` no queda saludable dentro de 180 segundos.

Estado remoto: pendiente de ejecutar tras subir el commit. Después del `push`,
pegar el enlace de la corrida y el resultado del job de LocalStack Pro aquí:

`[PEGAR AQUÍ EL ENLACE DE LA NUEVA EJECUCIÓN DE GITHUB ACTIONS Y EL RESULTADO DEL JOB DE LOCALSTACK PRO]`

La limpieza del aislamiento se comprobó localmente en éxito y fallo controlado.
En ambos casos Docker quedó igual: **0 contenedores, 3 redes y 14 volúmenes**
antes y después; no quedaron recursos `drive-clone-ci-*`. El `--tmpfs` evita
crear el volumen anónimo declarado por la imagen PostgreSQL y `docker rm -fv`
elimina cualquier volumen anónimo asociado al contenedor, sin tocar los
recursos `drive-clone-dev_*` ni los de otros proyectos. La corrida exitosa
aplicó las 4 migraciones; el chequeo ejecutó 89 pruebas aprobadas y 7 omitidas,
y la integración 26 aprobadas y 7 omitidas. La prueba de fallo controlado
retornó código 1 y también terminó sin residuos.

## Incorporar nuevas suites

1. Añada pruebas unitarias `*.test.ts` o `*.test.tsx` junto al módulo. Use Vitest
   y dependencias simuladas; la suite unitaria no debe requerir PostgreSQL.
2. Para casos que necesiten PostgreSQL, cree `*.integration.test.ts`. El comando
   `npm run test:integration` los selecciona; el script aislado aplica primero
   migraciones en PostgreSQL temporal y exporta JUnit a `reports/integration/`.
   No conecte estas pruebas a los contenedores o volúmenes de desarrollo.
3. Para contratos, añada pruebas en `packages/contracts/testing/` usando los
   esquemas fuente de `packages/contracts/src`; regenere artefactos con
   `npm run contracts:generate` y valide deriva con `npm run contracts:check`.
4. Mantenga los escenarios críticos de permisos y transiciones/estados, añada
   cualquier fuente nueva al `include` de `vitest.config.ts` y compruebe el
   reporte de cobertura, incluyendo archivos aún no ejecutados.
5. Ejecute formato, lint, tipos, suite pertinente y `npm run check:file-lines`.
   Reportes y fixtures con secretos reales no deben incorporarse al repositorio.
