# SIGAT — Sistema de Gestión Inteligente de Activos

Aplicación de escritorio para gestión segura de activos multi-base de datos con Angular + Tauri + Rust + SQLite.

- Versión actual: `1.7.0`
- Última actualización: `1 de Agosto 2026`

## Stack

- Frontend: Angular 21
- Backend: Rust + Tauri 2
- Base de datos: SQLite cifrada + SQLCipher
- Hash de contraseñas: Argon2id

## Características principales

- CRUD completo de activos con imágenes e historial de vistas
- Autenticación segura con roles (Administrador / Operador / Auditor)
- **Sistema de temas claro naranja / verde militar**: botón flotante redondo (esquina inferior derecha) para alternar entre el tema claro naranja (primario, activado por defecto al iniciar) y el tema verde militar oscuro; intercambio automático de wallpaper y emblema, texto azul real en modo claro y degradado naranja en el recuadro del emblema de Login/Register
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
- **Exportación a Excel con selección de campos**: archivo `.xlsx` con hoja de activos (11 campos seleccionables) y hoja de auditoría global, formato numérico `#,##0.00` para precios
- **Modales de confirmación**: para eliminar activos, usuarios y bases de datos con diseño militar
- **Admin auto-creación**: si no existe un administrador, crea uno automáticamente (env vars con prioridad y fallback garantizado `admin`/`admin123`), verificando el rol `administrador`
- **FK corregida al eliminar usuario**: limpia `auditoria`, `username_history`, `activos.responsable_id` y `activos.created_by`

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

# Admin por defecto (si no hay admins en el sistema):
# 1. Usa APP_DEFAULT_ADMIN_USERNAME / APP_DEFAULT_ADMIN_PASSWORD si están definidas (.env o env de compilación).
# 2. Si no, crea automáticamente: usuario "admin" con contraseña "admin123".
#    Este fallback garantiza que siempre exista un administrador (Windows, VM, otra máquina y Android).
#    Se recomienda cambiar la contraseña en el primer inicio.
```

## Comandos de testing

```bash
# Tests unitarios Angular
npm run test

# Suite de seguridad frontend (81 tests)
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
- ThemeService: estado inicial naranja, toggle de temas, aplicación de `data-theme` y no-persistence.

## Resultados validados

- Angular Unit Tests (`ng test`): `1/1 PASS`
- Frontend Security Suite: `81/81 PASS` (13 archivos)
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
