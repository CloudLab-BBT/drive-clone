# Infraestructura O02

`server.Dockerfile` crea la imagen compartida de API, trabajador y trabajos de inicialización. `web.Dockerfile` compila React y sirve el resultado con NGINX; `nginx.conf` define el proxy y límites de recepción. `compose.yaml` en la raíz une cinco servicios permanentes y tres trabajos puntuales. Las imágenes base están fijadas por versión y digest. Consulte `docs/operacion-o02.md` para arranque y diagnóstico.
