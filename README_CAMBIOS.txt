Cambios incluidos:
- Confirmar terminado ahora inserta/actualiza public.task_confirmations en Supabase.
- Quitar terminado ahora elimina la fila correspondiente en public.task_confirmations.
- Al abrir otra pagina, la confirmacion ya no debe reaparecer si fue retirada.
- Se mantiene tabla y Gantt agrupados, con despliegue independiente.
- Las dependencias/predecesores se detectan con mas formatos para bloquear confirmaciones amarradas.

Subir a GitHub reemplazando:
- assets/js/app.js
- assets/css/styles.css
- conexion.html
- alimentador.html
- index.html

Ejecutar en Supabase SQL Editor:
- supabase/confirmaciones-sync-patch.sql
