# Gestor de Activos

Aplicación de escritorio para gestión segura de activos multi-base de datos con Angular + Tauri + Rust + SQLite.

- Versión actual: `1.3.0`
- Última actualización: `14 de Julio 2026`

## Stack

- Frontend: Angular 21
- Backend: Rust + Tauri 2
- Base de datos: SQLite cifrada + SQLCipher
- Hash de contraseñas: Argon2id

## Características principales

- CRUD completo de activos con imágenes e historial de vistas
- Autenticación segura con roles (Administrador / Operador / Auditor)
- **Bases de Datos lógicas (Asignaciones)**: segmentación de activos por unidad/departamento
- Chatbot NLP con búsqueda inteligente en español
- Auditoría inmutable con exportación PDF/XML
- Base de datos cifrada con AES-256 (SQLCipher)

## Comandos principales

```bash
# Instalar dependencias
npm install

# Desarrollo (frontend + backend Tauri)
npm run dev

# Build frontend
npm run build

# Build app de escritorio (MSI)
npm run tauri build

# Build completo (Angular + MSI)
npm run build:installer

# Admin por defecto (configurar en src-tauri/.env)
# APP_DEFAULT_ADMIN_USERNAME=admin
# APP_DEFAULT_ADMIN_PASSWORD=admin123
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
