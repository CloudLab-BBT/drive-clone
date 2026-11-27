# Pruebas E2E y Regresiones (O14)

Esta documentación consolida los criterios de cobertura y los casos de prueba E2E para los requisitos **O07 – O13**. Cada fila describe la regla crítica, el caso de prueba implementado, el nivel de prueba y el resultado esperado.

| Requisito                                           | Regla crítica                                                                                   | Caso de prueba (archivo)                    | Nivel       | Resultado esperado                                                     |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| **O07** – Sesión inválida                           | Redirección a `/login` y mensajes de error visibles                                             | `e2e/auth.spec.ts`                          | E2E         | 302 → `/login`; textos de error aparecen.                              |
| **O08** – Creación y protección de carpetas         | No permite crear carpeta en raíz protegida; solo usuarios con permiso pueden crear sub‑carpetas | `e2e/sharing.spec.ts` (creación)            | E2E         | 403 al intentar crear en raíz; UI sin botón "Crear carpeta".           |
| **O09** – Límite de carga simultánea                | Máximo 10 archivos activos por usuario; exceso genera error 429                                 | `e2e/uploads.spec.ts` (carga 11 archivos)   | E2E         | 429 con mensaje _"límite alcanzado"_.                                  |
| **O10** – Procesamiento S3 → Worker → Base de datos | Flujo completo sin mocks, verifica SHA‑256 del archivo descargado                               | `e2e/uploads.spec.ts` (carga + descarga)    | E2E         | Archivo descargado idéntico al original (hash coincide).               |
| **O11** – Compartición y herencia de permisos       | READ no permite edición; EDIT permite; revocación conserva acceso heredado                      | `e2e/sharing.spec.ts` (compartir/renunciar) | E2E         | Usuario `reader` mantiene READ heredado tras revocar EDIT.             |
| **O12** – Renombrado y borrado recursivo            | No se permite renombrar/borrar dentro de carpetas protegidas; borrado recursivo libera recursos | `e2e/sharing.spec.ts` (borrado)             | E2E         | Operación rechazada con 403; borrado exitoso sólo en carpetas propias. |
| **O13** – Fallos internos de servicios              | Simulación de errores S3/SQS/DB y recuperación automática                                       | `e2e/resources.spec.ts` (fallos)            | Integración | Sistema reintenta y alcanza estado _COMPLETED_.                        |
| **O14** – Estabilidad y no‑flakiness                | Ejecutar suite E2E dos veces consecutivas en entornos limpios                                   | `scripts/test-e2e-isolated.sh` (doble run)  | E2E         | Ambas ejecuciones completan sin residuos ni fallos.                    |

**Procedimiento para validar localmente**

```
# Instalar dependencias y ejecutar checks básicos
npm ci && npm run format:check && npm run lint && npm run typecheck && npm run contracts:check && npm run check:file-lines

# Build monorepo
npm run build

# Unit tests
npm run test:unit

# Integración aislada (Postgres & LocalStack)
./scripts/test-integration-isolated.sh

# Ejecutar E2E dos veces (crea y destruye contenedores automáticamente)
./scripts/test-e2e-isolated.sh && ./scripts/test-e2e-isolated.sh

# Escaneo de secretos
docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.24.2 detect --source=/repo --no-git --config=/repo/.gitleaks.toml --report-format=json --report-path=/repo/reports/gitleaks-working-tree.json --redact
```

Los reportes se generan bajo `reports/` (excluido de Git). No se realizan commits ni push como parte de la ejecución.
