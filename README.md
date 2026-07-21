# SIGAT — Sistema de Gestión Inteligente de Activos

Aplicación de escritorio para gestión segura de activos multi-base de datos con Angular + Tauri + Rust + SQLite.

- Versión actual: `1.5.0`
- Última actualización: `21 de Julio 2026`

## Stack

- Frontend: Angular 21
- Backend: Rust + Tauri 2
- Base de datos: SQLite cifrada + SQLCipher
- Hash de contraseñas: Argon2id

## Características principales

- CRUD completo de activos con imágenes e historial de vistas
- Autenticación segura con roles (Administrador / Operador / Auditor)
- **Bases de Datos lógicas (Asignaciones)**: segmentación de activos por unidad/departamento
- **Home elegante**: carrusel de capacidades, partículas animadas, scroll fade-in, temática militar refinada
- **Login/Register con glassmorphism**: fondos oscuros con efecto blur, emblemas animados, inputs con focus dorado
- **Paleta militar unificada**: verdes oliva, dorados, crema — sin azules ni morados en ninguna pantalla
- **Chatbot NLP mejorado**: detección de fechas ("hoy"/"ayer"), consultas de auditoría por usuario y fecha, respuestas contextuales
- Chatbot NLP con búsqueda inteligente en español
- Auditoría inmutable con exportación PDF/XML
- Base de datos cifrada con AES-256 (SQLCipher)
- **Protección contra navegación atrás/adelante**: los botones del mouse no salen de la app estando logueado
- **Exportación/Importación de bases de datos**: archivo `.7z` cifrado con AES-256, contraseña aleatoria de 30 caracteres
- **Modales de confirmación**: para eliminar activos, usuarios y bases de datos con diseño militar

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

## Comandos de testing

```bash
# Tests unitarios Angular
npm run test

# Suite de seguridad frontend (44 tests)
npm run test:security:frontend

# Suite de seguridad backend
npm run test:security:backend

# Frontend + backend + resumen para CI
npm run test:security:ci
```

## Qué se valida en pruebas

- Login/sesión: persistencia segura, rechazo de credenciales inválidas, limpieza en logout.
- Guard de rutas: authGuard (bloqueo anónimo) + loginGuard (redirección si logueado).
- Chatbot: control por rol, parser de filtros (categoría, estado, marca, precio, pulgadas).
- Subida de archivos: límite de tamaño, validación de tipo y conversión base64.
- Performance frontend: umbrales de respuesta en login/chatbot/upload/bases_datos.
- Backend: criptografía, clave local, auditoría en DB y pruebas de rendimiento.
- AuthService: hasRole, carga de bases, timezone, logout.

## Resultados validados

- Angular Unit Tests (`ng test`): `1/1 PASS`
- Frontend Security Suite: `44/44 PASS` (11 archivos)
- Backend Security Suite: `5/5 PASS`
- Security CI Summary: `PASS frontend + PASS backend`

## Nota de configuración TypeScript

`tsconfig.app.json` sí se utiliza en el build de Angular y no debe eliminarse.
Se ajustó `rootDir` para compatibilidad con TypeScript 6 y eliminación de error de compilación.
`tsconfig.spec.json` incluye `tests/**/*.spec.ts` para soporte dual (ng test + vitest).

## Documentación extendida

Consulta el detalle funcional, técnico y changelog en:

- `PROYECTO.html`
- `PROYECTO.md`
