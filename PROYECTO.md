# Gestor de Activos - Centro de Investigación

Aplicación de escritorio para la gestión segura de activos del Centro de Investigación de la Escuela de Telecomunicaciones de Facatativá.

**Versión actual**: 1.0.0  
**Última actualización**: Febrero 2026

## 🔐 Características de Seguridad

- **Base de datos cifrada**: SQLite + SQLCipher con AES-256
- **Hash seguro de contraseñas**: Argon2id (ganador del Password Hashing Competition)
- **Sin exposición de red**: Aplicación 100% local, sin servidores HTTP ni APIs expuestas
- **Auditoría inmutable**: Registro completo de todas las operaciones
- **Comunicación interna segura**: Angular ↔ Rust mediante invocación controlada de Tauri

## 🏗️ Arquitectura

- **Frontend**: Angular 21 (interfaz gráfica)
- **Backend**: Rust + Tauri 2 (lógica crítica, seguridad, acceso a recursos)
- **Base de datos**: SQLite cifrado con SQLCipher
- **Criptografía**: Argon2id para hash de contraseñas


## 📁 Estructura del Proyecto

```
gestor-activos/
├── src/                    # Código Angular (frontend)
│   ├── app/
│   │   └── services/
│   │       └── tauri.service.ts  # Servicio para comunicación con Rust
│   └── ...
├── src-tauri/              # Código Rust (backend)
│   ├── src/
│   │   ├── lib.rs          # Punto de entrada principal
│   │   ├── db.rs           # Módulo de base de datos
│   │   ├── crypto.rs       # Módulo de criptografía y hash
│   │   └── commands.rs     # Comandos Tauri (API interna)
│   └── Cargo.toml          # Dependencias Rust
└── ...
```



## 🚀 Comandos de Desarrollo

### Instalar dependencias
```bash
npm install
```

### Ejecutar en modo desarrollo
```bash
npm run tauri dev
```

### Compilar para producción
```bash
npm run tauri build
```

El instalador MSI se generará en: `src-tauri/target/release/bundle/msi/`

## 🔧 Configuración de SQLCipher

Antes de compilar, configura las variables de entorno:


## 📋 Módulos Implementados

### 1. Módulo de Base de Datos (`db.rs`)
- Conexión segura a SQLite cifrado
- Inicialización de tablas (usuarios, activos, auditoría)
- Sistema de auditoría inmutable
- Historial de visualizaciones de activos

### 2. Módulo de Criptografía (`crypto.rs`)
- Hash de contraseñas con Argon2id
- Verificación de contraseñas
- Derivación de claves de cifrado

### 3. Módulo de Comandos (`commands.rs`)
- `create_user`: Crear usuarios con contraseñas hasheadas
- `login`/`logout`: Autenticación segura con auditoría
- `get_activos`: Consultar activos registrados
- `get_activo_detalles`: Obtener detalles completos de un activo
- `register_activo_vista`: Registrar visualización de activo
- `get_activo_vistas`: Obtener historial de visualizaciones
- `get_audit_log`: Obtener logs de auditoría filtrados

### 4. Componentes de Frontend

#### Dashboard
- Vista principal con estadísticas de activos
- Listado de activos recientes (últimos 5)
- Modal interactivo de detalles de activo
- Sidebar de navegación con menú militar-themed

#### Activos
- CRUD completo de activos (crear, leer, actualizar, eliminar)
- Búsqueda y filtros avanzados
- Paginación (40 items por página)
- Modal de detalles con:
  - Información general del activo
  - Imagen del activo
  - Fechas de registro y vencimiento
  - **Historial de visualizaciones (solo admin)**
- Filtros por: código, nombre, categoría, ubicación, estado, rango de valor, tiempo de vencimiento

#### Auditoría
- Timeline visual de eventos del sistema
- Filtros por acción: CREATE, UPDATE, DELETE
- **Filtros LOGIN/LOGOUT (solo admin)**
- **Logs de autenticación ocultos para usuarios no-admin**
- Agrupación por fecha con paginación automática
- Iconos y badges diferenciados por tipo de acción

#### Usuarios (Admin)
- Gestión de usuarios del sistema
- Asignación de roles (admin/user)
- Configuración de zonas horarias

#### Perfil
- Visualización y edición de datos personales
- Cambio de contraseña seguro
- Configuración de zona horaria

## 🔐 Seguridad por Diseño

1. **Cifrado de datos en reposo**: Toda la base de datos está cifrada con AES-256
2. **Hash irreversible**: Las contraseñas nunca se almacenan en texto plano
3. **Auditoría completa**: Registro inmutable de todas las operaciones
4. **Sin exposición de red**: La aplicación no abre puertos ni expone servicios
5. **Separación de responsabilidades**: La lógica crítica está en Rust, Angular solo maneja la UI
6. **Control de acceso basado en roles (RBAC)**:
   - **Usuarios Admin**: Acceso completo, gestión de usuarios, visualización de historial de vistas, acceso a logs de LOGIN/LOGOUT
   - **Usuarios Regulares**: CRUD de activos, visualización de auditoría limitada (solo CREATE/UPDATE/DELETE)

## 🎨 Diseño de Interfaz

### Tema Militar Elegante
- **Paleta de colores**: 
  - Primario: `#556B2F` (verde oliva oscuro)
  - Secundario: `#6B8E23` (oliva drab)
  - Fondo: `#E8E4D9` (arena claro)
  - Texto: `#2A2D1E` (verde oscuro casi negro)
  - Bordes: `#8B7355` (khaki)
  
- **Tipografía**:
  - **Títulos**: 'Playfair Display' (serif elegante, peso 400-800)
  - **Cuerpo**: 'Lato' (sans-serif moderna, peso 300-700)
  
- **Características visuales**:
  - Gradientes militares sutiles en tarjetas y banners
  - Efecto de camuflaje sutil en login
  - Bordes sólidos de 2-3px con colores militares
  - Badges diferenciados por tipo de acción
  - Hover effects con translateY(-2px)
  - Scrollbar personalizado con tema militar

### Sistema de Componentes
- Cards con sombras y bordes militares
- Botones con gradientes y efectos hover
- Inputs con focus militar (sombra verde oliva)
- Timeline visual para auditoría
- Modales overlay con backdrop difuminado
- Sidebar de navegación con gradiente militar

## 📝 Uso Básico

### Desde Angular (Frontend)

```typescript
import { TauriService } from './services/tauri.service';

// Inyectar el servicio
constructor(private tauriService: TauriService) {}

// Obtener activos
const activos = await this.tauriService.getActivos();
```

## ⚠️ Notas Importantes

- La clave de cifrado de la base de datos debe derivarse de credenciales válidas del usuario en producción
- El ejemplo actual usa una clave temporal solo para desarrollo
- Se recomienda implementar un sistema de gestión de claves maestras para producción
- La base de datos se almacena en el directorio de datos de la aplicación
- DEV: npm run dev
- RUN: npm start
## 🛡️ Cumplimiento de Requisitos

✅ Aplicación de escritorio sin dependencia de internet  
✅ Sin exposición de puertos ni servicios de red  
✅ Base de datos SQLite cifrada con SQLCipher (AES-256)  
✅ Hash seguro de contraseñas con Argon2id  
✅ Sistema de auditoría inmutable  
✅ Separación frontend/backend con control estricto de permisos  
✅ Instalador y desinstalador nativos (MSI para Windows)  
✅ Control de acceso basado en roles (RBAC)  
✅ Interfaz de usuario con diseño militar elegante

## 🔒 Control de Acceso Basado en Roles

### Restricciones por Rol

#### Solo Administradores pueden:
- **Ver historial de visualizaciones de activos**: El componente de detalles de activo muestra quién y cuándo vio cada activo
- **Ver logs de LOGIN/LOGOUT**: En el módulo de auditoría, los administradores ven todos los eventos de autenticación
- **Filtrar por LOGIN/LOGOUT**: Los filtros de auditoría incluyen estas opciones solo para admin
- **Gestionar usuarios**: Crear, modificar y eliminar usuarios del sistema
- **Asignar roles**: Promover usuarios a admin o degradar a usuario regular

#### Usuarios Regulares pueden:
- **CRUD de activos**: Crear, leer, actualizar y eliminar activos
- **Ver auditoría limitada**: Solo eventos CREATE, UPDATE, DELETE
- **Gestionar su perfil**: Cambiar contraseña y configurar zona horaria
- **Búsqueda y filtros**: Acceso completo a búsquedas y filtros de activos

### Implementación Técnica

```typescript
// En componentes con restricciones
isAdmin(): boolean {
  return this.authService.hasRole('admin');
}

// En templates Angular
@if (isAdmin()) {
  <!-- Contenido exclusivo para admin -->
}

// Filtrado automático de logs
if (!this.authService.hasRole('admin')) {
  logsParaAgrupar = logsParaAgrupar.filter(log => 
    log.action !== 'LOGIN' && log.action !== 'LOGOUT'
  );
}
```

## 📊 Características Avanzadas

### Sistema de Visualizaciones
- Registro automático cuando un usuario ve los detalles de un activo
- Historial completo con username y timestamp
- Solo visible para administradores
- Útil para auditoría de acceso a información sensible

### Auditoría Avanzada
- Timeline visual agrupada por fechas
- Paginación automática para días con +100 eventos
- Iconos SVG personalizados por tipo de acción
- Badges de color según criticidad:
  - Verde: CREATE (éxito)
  - Amarillo: UPDATE (advertencia)
  - Rojo: DELETE (peligro)
  - Azul: LOGIN/LOGOUT (información)

### Gestión de Activos
- Filtros avanzados multi-criterio
- Calculadora de vida útil y porcentaje de tiempo disponible
- Estados: operativo, en mantenimiento, fuera de servicio, en reparación
- Categorías: Equipos de cómputo, telecomunicaciones, mobiliario, herramientas, software
- Almacenamiento de imágenes en base64
- Alertas visuales para activos próximos a vencer

## 📝 Historial de Cambios

### Versión 1.0.0 (Febrero 2026)

#### Características Nuevas
- ✨ Rediseño completo de UI con tema militar elegante
- ✨ Modal de detalles de activos en dashboard (clic en activos recientes)
- ✨ Sistema de visualizaciones de activos con historial
- ✨ Control de acceso basado en roles (RBAC)
- ✨ Filtros avanzados en componente de activos
- ✨ Timeline visual de auditoría con agrupación por fechas

#### Mejoras de Seguridad
- 🔒 Historial de visualizaciones solo visible para administradores
- 🔒 Logs de LOGIN/LOGOUT restringidos a administradores
- 🔒 Filtrado automático de eventos de autenticación para usuarios regulares
- 🔒 Validación de permisos en frontend y backend

#### Mejoras de UI/UX
- 🎨 Paleta de colores militar (verde oliva, khaki, arena)
- 🎨 Tipografía elegante: Playfair Display + Lato
- 🎨 Gradientes militares sutiles en componentes
- 🎨 Efecto de camuflaje en pantalla de login
- 🎨 Scrollbar personalizado con tema militar
- 🎨 Badges diferenciados por tipo de acción
- 🎨 Hover effects mejorados en cards y botones

#### Correcciones
- 🐛 Arreglado error de sintaxis SCSS en login.component.scss (faltaba cierre de llaves)
- 🐛 Corregidos errores de lifetime en Rust (manejo de ventana de cierre)
- 🐛 Conversión de tokio::sync::Mutex a std::sync::Mutex para acceso síncrono

#### Archivos Modificados
- `src/styles.scss`: Variables CSS para tema militar, importación de Google Fonts
- `src/app/components/login/login.component.scss`: Tema militar con efecto camuflaje
- `src/app/components/dashboard/dashboard.component.*`: Modal de detalles, restricciones de admin
- `src/app/components/activos/activos.component.*`: Restricciones de admin en visualizaciones
- `src/app/components/audit/audit.component.*`: Filtros dinámicos según rol, iconos LOGOUT
- `src/app/components/profile/profile.component.scss`: Tema militar
- `src/app/components/users/users.component.scss`: Tema militar
- `src/app/services/auth.service.ts`: Método hasRole() para control de acceso
- `src-tauri/src/lib.rs`: Corrección de lifetimes en window event handler
- `src-tauri/src/commands.rs`: Conversión a std::sync::Mutex

#### Estado del Proyecto
- ✅ Backend Rust completamente funcional
- ✅ Frontend Angular con todos los componentes implementados
- ✅ Sistema de autenticación y autorización completo
- ✅ Base de datos cifrada con auditoría inmutable
- ✅ Diseño UI consistente en toda la aplicación
- ✅ Sin errores de compilación
- ✅ Listo para testing y deployment  

