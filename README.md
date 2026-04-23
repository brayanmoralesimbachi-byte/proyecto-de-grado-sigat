# Gestor de Activos

Aplicación de escritorio para gestión segura de activos con Angular + Tauri + Rust + SQLite.

- Versión actual: `1.2.0`
- Última actualización: `22 de Abril 2026`

## Stack

- Frontend: Angular 21
- Backend: Rust + Tauri 2
- Base de datos: SQLite cifrada
- Hash de contraseñas: Argon2id

## Comandos principales

```bash
# Instalar dependencias
npm install

# Desarrollo (frontend + backend Tauri)
npm run dev

# Build frontend
npm run build

# Build app de escritorio
npm run tauri build
```

## Comandos de testing de seguridad

```bash
# Suite de seguridad frontend
npm run test:security:frontend

# Suite de seguridad backend
npm run test:security:backend

# Frontend + backend + resumen para CI
npm run test:security:ci
```

## Qué se valida en pruebas

- Login/sesión: persistencia segura, rechazo de credenciales inválidas, limpieza en logout.
- Guard de rutas: bloqueo de acceso anónimo.
- Chatbot: control por rol para auditorías y respuesta funcional.
- Subida de archivos: límite de tamaño, validación de tipo y conversión base64.
- Performance frontend: umbrales de respuesta en login/chatbot/upload.
- Backend: criptografía, clave local, auditoría en DB y pruebas de rendimiento.

## Resultados validados

- Frontend Security Suite: `14/14 PASS`
- Backend Security Suite: `5/5 PASS`
- Security CI Summary: `PASS frontend + PASS backend`

## Nota de configuración TypeScript

`tsconfig.app.json` sí se utiliza en el build de Angular y no debe eliminarse.
Se ajustó `rootDir` para compatibilidad con TypeScript 6 y eliminación de error de compilación.

## Documentación extendida

Consulta el detalle funcional, técnico y changelog en:

- `PROYECTO.html`
- `PROYECTO.md`
