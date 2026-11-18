# Generación de artefactos

`generate.ts` importa `createOpenApi`, UploadMessage y DeleteMessage; sin parámetros genera los tres JSON de `../generated/`, con `--check` compara bytes y falla si faltan o difieren. Retorno: código 0 y mensaje en español, o error/código distinto de cero. No usa servicios ni secretos; requiere Node 24 y dependencias npm. No contiene rutas HTTP ni publica archivos remotamente.

Comandos públicos desde raíz: `npm run contracts:generate` y `npm run contracts:check`. La comparación detecta deriva entre fuentes y entregables versionados.
