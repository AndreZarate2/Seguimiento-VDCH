Cambios incluidos:
- Gantt corregido para abrir totalmente desplegado por defecto.
- Se cambio la clave de estado local del arbol a zc_tree_state_v6_gantt_full para evitar que el navegador reutilice un Gantt colapsado guardado antes.
- La tabla conserva vista agrupada inicial, pero el Gantt queda expandido completo.
- Nueva escala mensual horizontal para cronogramas largos; ya no queda comprimido en un solo rango de fechas.
- Barras con avance interno, hitos en rombo, filas mas compactas, columna de actividad fija y auto-centrado en la fecha de control.
- Se conserva la lectura desde Supabase y el fallback a data/projects.json.
- Se agrego la carpeta supabase/ con schema.sql y confirmaciones-sync-patch.sql porque el README la mencionaba pero no estaba dentro del ZIP.
- Confirmar terminado sigue insertando/actualizando public.task_confirmations en Supabase.
- Quitar terminado sigue eliminando la fila correspondiente en public.task_confirmations.

Subir a GitHub reemplazando:
- assets/js/app.js
- assets/css/styles.css
- conexion.html
- alimentador.html
- index.html
- supabase/schema.sql
- supabase/confirmaciones-sync-patch.sql

Ejecutar en Supabase SQL Editor:
1. supabase/schema.sql si estas creando o alineando la base.
2. supabase/confirmaciones-sync-patch.sql si quieres que los botones publicos de Confirmar / Quitar terminado escriban desde la web con publishable key.
