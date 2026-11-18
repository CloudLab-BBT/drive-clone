# Contratos compartidos v1

Paquete `@drive-clone/contracts`, sin transporte ni lógica de aplicación. Fuente TypeScript/TypeBox en `src/`, artefactos públicos en `generated/`, generador en `scripts/` y verificaciones en `testing/`. Consumidores previstos: React, Fastify y trabajador, aún no implementados.

```ts
import { CreateUpload, type Static } from '@drive-clone/contracts';
type CreateUploadInput = Static<typeof CreateUpload>;
```

Desde raíz: `npm ci`, `npm run contracts:generate`, `npm run check`.
Node 24 LTS ejecuta el generador TypeScript por eliminación de tipos; `tsc --noEmit` revisa estrictamente antes de aceptar cambios. No se necesita DB. O02 añadirá la configuración de build de consumidores sin duplicar esquemas.

JSON generado se guarda compacto para comparación determinista; para inspección legible: `node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync("packages/contracts/generated/openapi.json")),null,2))'`.

Cada cambio incompatible requiere una nueva versión, actualización de documentación y regeneración de artefactos. Los archivos generados se actualizan mediante el script, no por edición directa. Las pruebas del paquete validan contratos; la integración se comprueba en las aplicaciones consumidoras.
