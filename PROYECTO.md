# Gestor de Activos - Centro de Investigación

Aplicación de escritorio para la gestión segura de activos del Centro de Investigación de la Escuela de Telecomunicaciones de Facatativá.

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

```bash
set SQLITE3_LIB_DIR=C:\ruta\a\sqlcipher
set SQLITE3_INCLUDE_DIR=C:\ruta\a\sqlcipher
```

## 📋 Módulos Implementados

### 1. Módulo de Base de Datos (`db.rs`)
- Conexión segura a SQLite cifrado
- Inicialización de tablas (usuarios, activos, auditoría)
- Sistema de auditoría inmutable

### 2. Módulo de Criptografía (`crypto.rs`)
- Hash de contraseñas con Argon2id
- Verificación de contraseñas
- Derivación de claves de cifrado

### 3. Módulo de Comandos (`commands.rs`)
- `create_user`: Crear usuarios con contraseñas hasheadas
- `login`: Autenticación segura de usuarios
- `get_activos`: Consultar activos registrados

## 🔐 Seguridad por Diseño

1. **Cifrado de datos en reposo**: Toda la base de datos está cifrada con AES-256
2. **Hash irreversible**: Las contraseñas nunca se almacenan en texto plano
3. **Auditoría completa**: Registro inmutable de todas las operaciones
4. **Sin exposición de red**: La aplicación no abre puertos ni expone servicios
5. **Separación de responsabilidades**: La lógica crítica está en Rust, Angular solo maneja la UI

## 📝 Uso Básico

### Desde Angular (Frontend)

```typescript
import { TauriService } from './services/tauri.service';

// Inyectar el servicio
constructor(private tauriService: TauriService) {}

// Crear usuario
await this.tauriService.createUser('admin', 'password123', 'administrador');

// Login
const response = await this.tauriService.login({
  username: 'admin',
  password: 'password123'
});

// Obtener activos
const activos = await this.tauriService.getActivos();
```

## ⚠️ Notas Importantes

- La clave de cifrado de la base de datos debe derivarse de credenciales válidas del usuario en producción
- El ejemplo actual usa una clave temporal solo para desarrollo
- Se recomienda implementar un sistema de gestión de claves maestras para producción
- La base de datos se almacena en el directorio de datos de la aplicación

## 🛡️ Cumplimiento de Requisitos

✅ Aplicación de escritorio sin dependencia de internet  
✅ Sin exposición de puertos ni servicios de red  
✅ Base de datos SQLite cifrada con SQLCipher (AES-256)  
✅ Hash seguro de contraseñas con Argon2id  
✅ Sistema de auditoría inmutable  
✅ Separación frontend/backend con control estricto de permisos  
✅ Instalador y desinstalador nativos (MSI para Windows)  

## 📄 Licencia

Proyecto académico - Escuela de Telecomunicaciones de Facatativá
