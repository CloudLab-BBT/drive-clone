# Reglas comunes de recursos

- `name.ts` normaliza un nombre a NFC, recorta espacios externos y valida longitud
  y caracteres. Devuelve `{ name, nameKey }` para compartir el espacio de nombres
  entre carpetas y archivos. `name.test.ts` cubre normalización y entradas inválidas.
- `creation.ts` recibe una conexión transaccional, el usuario y el padre.
  Bloquea la fila del usuario, evalúa `CREATE_CHILD` con la política común, valida
  que el destino sea una carpeta activa y comprueba la profundidad de la nueva
  ubicación. Se usa al crear carpetas y reservar archivos. La publicación de
  archivos ya reevalúa `CREATE_CHILD` bajo el mismo bloqueo.

La raíz tiene profundidad cero. PostgreSQL limita los recursos a diez niveles
bajo la raíz y mantiene un índice único sobre padre y nombre normalizado.
El borrado de O12 debe tomar el mismo bloqueo del propietario antes de marcar
el árbol. La prueba de O08 reproduce ese cambio de estado en PostgreSQL.
