# Validación de O02

Fecha: 2026-11-19. Estado: criterios locales de O02 validados; ejecución de CI pendiente de O03.

| Comprobación | Resultado | Alcance |
| --- | --- | --- |
| `npm exec -w @drive-clone/server -- prisma validate` | Aprobado | Sintaxis y relaciones del esquema Prisma 7; no aplica SQL. |
| `npm ci`, `npm run generate -w @drive-clone/server` y `npm run check` | Aprobado: 30 pruebas | Lockfile, generación de Prisma, contratos y pruebas de timeout y respuesta HTTP de salud. La comparación de artefactos admite finales de línea de Windows sin alterar su contenido. |
| `npm run typecheck -w @drive-clone/server` | Aprobado | Tipos del backend O02. |
| `npm run build -w @drive-clone/web` | Aprobado | Compilación de la pantalla inicial React. |
| `docker compose --env-file .env.docker.example config --quiet` | Aprobado | Sintaxis Compose, sin levantar servicios. |
| API con PostgreSQL/S3/SQS inaccesibles | Aprobado: live 200, ready 503 | Respuesta pública ajustada a Health: solo `status`, sin diagnósticos ni secretos. |
| `npm audit --json` | Aprobado: 0 avisos | Consulta actual del 2026-11-19; los seis avisos de la consulta anterior no se reprodujeron. |
| Arranque real, migración limpia y bootstrap | Aprobado con imagen comunitaria | Cinco servicios arrancaron; tres migraciones aplicadas; bucket, SQS y DLQ creados. La repetición no dejó migraciones pendientes. |
| Health vía NGINX | Aprobado antes del reinicio | `live=200`, `ready=200`, web 200; checks de DB, S3, SQS, DLQ y temporal verdaderos. |
| Persistencia LocalStack | Aprobado con plan Student | Tras escribir objeto y mensaje de prueba, esperar el snapshot y reiniciar, se recuperaron el objeto con hash idéntico y el mismo mensaje. Readiness volvió a 200. Con `freemium` la prueba había fallado. |
| Acceso LocalStack para CI | Preparado, ejecución pendiente | El plan Student incluye pruebas en CI según la documentación oficial. `gh secret list -R CloudLab-BBT/drive-clone` confirmó el nombre `LOCALSTACK_AUTH_TOKEN` en GitHub Actions. No se puede leer el valor ni se autenticó en un runner; O03 debe probar el arranque no interactivo. |
| Permisos del temporal | Aprobado | API escribió y trabajador leyó; trabajador escribió y API leyó. Se retiraron ambos archivos de prueba. |
| Reinicio y recuperación de LocalStack | Aprobado | Tras reinicio, objeto y mensaje persistieron y readiness volvió a 200. |
| Caída controlada y recuperación | Aprobado | `docker compose stop localstack`: live 200 con `{"status":"ok"}` y ready 503 con `{"status":"unavailable"}`. Tras `docker compose start localstack` y estado healthy, ready volvió a 200; los cinco servicios quedaron activos. |

La prueba de salud arrancó también la API con dependencias deliberadamente inaccesibles y obtuvo `live=200`, `ready=503`. El arranque con Pro 2026.3.0, migración, bootstrap, checks, persistencia y caída/recuperación controlada aprobaron con Student. La presencia del secreto y la aptitud documental del plan no prueban su autenticación en CI. No se ha declarado funcional el trabajador de cargas.

## Correcciones de la revisión del 2026-11-19

La migración `202611190001_review_fixes` se aplicó en PostgreSQL 17.7 y no dejó migraciones pendientes al repetir `migrate deploy`. En una transacción revertida, PostgreSQL rechazó autorreferencia, padre inexistente, cambio de `kind` en carpeta con hijo y cada uno de los cuatro metadatos nulos de FILE ACTIVE. Bootstrap quedó con `maxReceiveCount=20`, leído directamente de SQS. Readiness público respondió `{"status":"ok"}` con 200 y el test HTTP comprobó `{"status":"unavailable"}` con 503, sin diagnósticos públicos. Aprobaron 30 pruebas, tipos y `git diff --check`. La ejecución del pipeline CI aún corresponde a otra tarea.
