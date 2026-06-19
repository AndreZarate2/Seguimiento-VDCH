# Seguimiento ZC Piura

Plataforma preparada para publicarse en GitHub Pages y conectarse con Supabase.

## Archivos principales

- `index.html`: panel general.
- `conexion.html`: vista Conexión VDCH.
- `alimentador.html`: vista Alimentador Sullana.
- `admin.html`: panel administrador con login de Supabase y carga de archivos `.mpp`.
- `assets/js/config.js`: configuración pública de Supabase y repositorio.
- `supabase/schema.sql`: SQL corregido para crear/adaptar tablas, RLS, bucket y administrador.
- `.github/workflows/convert-mpp.yml`: convierte archivos `.mpp` subidos al repositorio.
- `.github/workflows/process-supabase-mpp.yml`: procesa archivos `.mpp` subidos desde `admin.html` a Supabase Storage.

## Login administrador

El panel `admin.html` usa Supabase Auth.

- Correo: `mzarate@cvcenergia.com.pe`
- Contraseña: se configura solo en Supabase Authentication. No se guarda en el SQL ni en el código.

## Flujo recomendado

1. Crear el usuario administrador en Supabase Authentication.
2. Ejecutar `supabase/schema.sql` en SQL Editor.
3. Subir esta carpeta a GitHub.
4. Configurar GitHub Pages.
5. Configurar secrets del repositorio:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
6. Entrar a `admin.html`, iniciar sesión y subir el nuevo `.mpp`.
7. Ejecutar el workflow `Procesar MPP subido a Supabase` desde GitHub Actions.
8. La conversión actualiza `projects`, `tasks` y el respaldo `data/projects.json`.

## Configuración pública

`assets/js/config.js` ya contiene:

```js
supabaseUrl: "https://ukrvjijoxthhkxnygapw.supabase.co"
supabaseKey: "sb_publishable_jcIYxXiZc53Z2szrPk9r7Q_Baxtumrr"
adminEmail: "mzarate@cvcenergia.com.pe"
```

La publishable key puede estar en frontend. La `service_role` nunca debe colocarse en el código público.

## Notas

- La web pública lee primero desde Supabase.
- Si Supabase falla, usa `data/projects.json` como respaldo.
- El bucket `mpp-files` es privado.
- Solo usuarios en `admin_profiles` con `role = admin` pueden subir `.mpp`.
