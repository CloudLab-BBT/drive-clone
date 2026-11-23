# Controles de calidad (O03)

## Entorno local

Se requiere Docker y Docker Compose v2; las herramientas Node se ejecutan con
`node:24.21.0-bookworm-slim`. No hace falta Node instalado en el anfitrión.
`npm ci` instala las dependencias fijadas por `package-lock.json`. Los valores
locales de `.env.docker.example` son marcadores, no secretos: use valores
aleatorios solo para entornos persistentes. Las pruebas aisladas usan una clave
efímera y no requieren `.env`, LocalStack ni servicios de desarrollo.

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

| Controles locales | GitHub Actions |
| --- | --- |
| `format:check`, `lint`, `typecheck`, `contracts:check` y `check:file-lines`, en el contenedor Node 24. | Mismos controles en el job `quality`, sin secretos. |
| `npm run test:coverage` ejecuta pruebas unitarias y escribe cobertura. | Job `unit`, sube `reports/` como artefacto. |
| `./scripts/test-integration-isolated.sh` hace `npm ci`, migra PostgreSQL efímero, ejecuta `npm run check` y genera JUnit de integración. | Job `integration` ejecuta el mismo flujo aislado y publica sus reportes. |
| `npm run build` genera Prisma y construye el frontend; `docker compose build` construye imágenes localmente, sin publicarlas. | Job `build-and-scan` compila y construye las imágenes, sin publicar ni desplegar. |
| `npm run audit:dependencies` guarda el resultado JSON de `npm audit`. | Job `build-and-scan` audita dependencias, filesystem, imágenes y secretos; sube reportes. |

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

Las referencias iniciales del proyecto son **85% de líneas y funciones, y 80%
de ramas** del código propio. Son objetivos de referencia ajustables si el
docente establece una exigencia superior; no son resultados ya alcanzados ni
umbrales impuestos sobre módulos futuros aún sin implementar. Las pruebas deben
cubrir especialmente decisiones críticas de permisos, raíz protegida,
autenticación y estados terminales.

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

La detección Gitleaks separa historial Git y árbol de trabajo. El pipeline usa
`pull_request` y `push` a `main`, acciones fijadas por SHA, permisos de solo
lectura y no recibe secretos para ejecutar código de PR.
La allowlist excluye `.env` local (ignorado por Git), reportes generados y una
contraseña sintética fija de fixture; los demás hallazgos mantienen el fallo
predeterminado de Gitleaks.

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
