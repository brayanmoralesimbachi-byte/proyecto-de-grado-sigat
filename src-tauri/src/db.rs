use crate::crypto::hash_password;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::path::PathBuf;
use std::str::FromStr;

/// Estructura para manejar la conexión a la base de datos SQLite cifrada
pub struct Database {
    pool: SqlitePool,
}

impl Database {
    /// Crea una nueva conexión a la base de datos SQLite
    /// 
    /// # Arguments
    /// * `db_path` - Ruta al archivo de base de datos
    /// * `encryption_key` - Clave de cifrado derivada de las credenciales del usuario
    pub async fn new(db_path: PathBuf, encryption_key: &str) -> Result<Self, sqlx::Error> {
        // Configurar opciones de conexión para SQLite
        let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", db_path.display()))?
            .create_if_missing(true)
            .pragma("key", format!("'{}'", encryption_key)) // Clave de cifrado para SQLCipher
            .pragma("cipher_page_size", "4096")
            .pragma("kdf_iter", "256000"); // Iteraciones PBKDF2 para derivación de clave

        // Crear pool de conexiones
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;

        Ok(Database { pool })
    }

    /// Inicializa las tablas de la base de datos
    pub async fn initialize(&self) -> Result<(), sqlx::Error> {
        // Tabla de usuarios con contraseñas hasheadas
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS usuarios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                rol TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Tabla de activos
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS activos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                codigo TEXT NOT NULL UNIQUE,
                nombre TEXT NOT NULL,
                descripcion TEXT,
                categoria TEXT NOT NULL,
                ubicacion TEXT,
                responsable_id INTEGER,
                estado TEXT NOT NULL,
                valor_adquisicion REAL,
                fecha_adquisicion DATE,
                fecha_vencimiento DATE,
                imagen_base64 TEXT,
                created_by INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (responsable_id) REFERENCES usuarios(id),
                FOREIGN KEY (created_by) REFERENCES usuarios(id)
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Tabla de historial de cambios de nombres de usuario
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS username_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                old_username TEXT NOT NULL,
                new_username TEXT NOT NULL,
                changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES usuarios(id)
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Tabla de auditoría inmutable
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS auditoria (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                usuario_id INTEGER NOT NULL,
                accion TEXT NOT NULL,
                tabla TEXT NOT NULL,
                registro_id INTEGER NOT NULL,
                datos_anteriores TEXT,
                datos_nuevos TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Tabla de vistas de activos (historial de visualizaciones)
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS activo_vistas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                activo_id INTEGER NOT NULL,
                usuario_id INTEGER NOT NULL,
                viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (activo_id) REFERENCES activos(id) ON DELETE CASCADE,
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Migración: Agregar columna imagen_base64 si no existe
        // Verificar si la columna existe
        let table_info: Vec<(i64, String, String, i64, Option<String>, i64)> = sqlx::query_as(
            "PRAGMA table_info(activos)"
        )
        .fetch_all(&self.pool)
        .await?;

        let has_imagen_column = table_info.iter().any(|(_, name, _, _, _, _)| name == "imagen_base64");
        let has_fecha_vencimiento_column = table_info.iter().any(|(_, name, _, _, _, _)| name == "fecha_vencimiento");
        let has_created_by_column = table_info.iter().any(|(_, name, _, _, _, _)| name == "created_by");

        if !has_imagen_column {
            // Agregar la columna imagen_base64 a la tabla existente
            sqlx::query("ALTER TABLE activos ADD COLUMN imagen_base64 TEXT")
                .execute(&self.pool)
                .await?;
        }

        if !has_fecha_vencimiento_column {
            // Agregar la columna fecha_vencimiento a la tabla existente
            sqlx::query("ALTER TABLE activos ADD COLUMN fecha_vencimiento DATE")
                .execute(&self.pool)
                .await?;
        }

        if !has_created_by_column {
            // Agregar la columna created_by a la tabla existente
            sqlx::query("ALTER TABLE activos ADD COLUMN created_by INTEGER")
                .execute(&self.pool)
                .await?;
        }

        // Tabla de bases de datos (grupos lógicos independientes)
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS bases_datos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL UNIQUE,
                descripcion TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Tabla de asignación usuario <-> base_datos
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS usuario_base_datos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                usuario_id INTEGER NOT NULL,
                base_datos_id INTEGER NOT NULL,
                assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
                FOREIGN KEY (base_datos_id) REFERENCES bases_datos(id) ON DELETE CASCADE,
                UNIQUE(usuario_id, base_datos_id)
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Migración: Agregar columna timezone a usuarios si no existe
        let user_table_info: Vec<(i64, String, String, i64, Option<String>, i64)> = sqlx::query_as(
            "PRAGMA table_info(usuarios)"
        )
        .fetch_all(&self.pool)
        .await?;

        let has_timezone_column = user_table_info.iter().any(|(_, name, _, _, _, _)| name == "timezone");

        if !has_timezone_column {
            // Agregar la columna timezone con valor por defecto 'America/Bogota'
            sqlx::query("ALTER TABLE usuarios ADD COLUMN timezone TEXT DEFAULT 'America/Bogota'")
                .execute(&self.pool)
                .await?;
            
            // Actualizar usuarios existentes para tener la zona horaria por defecto
            sqlx::query("UPDATE usuarios SET timezone = 'America/Bogota' WHERE timezone IS NULL")
                .execute(&self.pool)
                .await?;
        }

        // Tabla de categorías personalizadas
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS categorias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL UNIQUE,
                descripcion TEXT,
                color TEXT DEFAULT '#667eea',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Tabla de keywords para búsqueda del chatbot
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS keywords (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                palabra TEXT NOT NULL,
                palabra_normalizada TEXT NOT NULL,
                tipo TEXT NOT NULL,
                categoria_asociada TEXT,
                idioma TEXT DEFAULT 'es',
                es_sinonimo_de TEXT,
                activo BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Índice para búsqueda rápida de keywords
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_keywords_normalizada ON keywords(palabra_normalizada)"
        )
        .execute(&self.pool)
        .await?;

        // Migración: Agregar columna palabras_clave a activos si no existe
        let has_palabras_clave = table_info.iter().any(|(_, name, _, _, _, _)| name == "palabras_clave");
        if !has_palabras_clave {
            sqlx::query("ALTER TABLE activos ADD COLUMN palabras_clave TEXT")
                .execute(&self.pool)
                .await?;
        }

        // Migración: Agregar columna base_datos_id a activos si no existe
        let has_base_datos_activos = table_info.iter().any(|(_, name, _, _, _, _)| name == "base_datos_id");
        if !has_base_datos_activos {
            sqlx::query("ALTER TABLE activos ADD COLUMN base_datos_id INTEGER REFERENCES bases_datos(id)")
                .execute(&self.pool)
                .await?;
        }

        // Migración: Agregar columna base_datos_id a auditoria si no existe
        let audit_table_info: Vec<(i64, String, String, i64, Option<String>, i64)> = sqlx::query_as(
            "PRAGMA table_info(auditoria)"
        )
        .fetch_all(&self.pool)
        .await?;

        let has_base_datos_audit = audit_table_info.iter().any(|(_, name, _, _, _, _)| name == "base_datos_id");
        if !has_base_datos_audit {
            sqlx::query("ALTER TABLE auditoria ADD COLUMN base_datos_id INTEGER REFERENCES bases_datos(id)")
                .execute(&self.pool)
                .await?;
        }

        // Insertar categorías base si no existen
        let categorias_base = vec![
            ("Equipos de Cómputo", "Computadores, laptops, monitores, etc.", "#3b82f6"),
            ("Equipos de Telecomunicaciones", "Routers, switches, teléfonos, etc.", "#8b5cf6"),
            ("Mobiliario", "Sillas, escritorios, mesas, etc.", "#f59e0b"),
            ("Herramientas", "Herramientas manuales y eléctricas", "#ef4444"),
            ("Software", "Licencias y programas", "#10b981"),
            ("Armamento", "Armas, rifles, pistolas, etc.", "#dc2626"),
            ("Municiones", "Balas, cartuchos, granadas, etc.", "#b91c1c"),
            ("Equipamiento Táctico", "Chalecos, cascos, mochilas tácticas", "#78716c"),
            ("Vehículos", "Carros, motos, camiones, etc.", "#0ea5e9"),
            ("Equipos Médicos", "Botiquines, camillas, desfibriladores", "#ec4899"),
            ("Comunicaciones", "Radios, walkie-talkies, antenas", "#6366f1"),
            ("Otro", "Otros activos no categorizados", "#6b7280"),
        ];

        for (nombre, descripcion, color) in categorias_base {
            sqlx::query(
                "INSERT OR IGNORE INTO categorias (nombre, descripcion, color) VALUES (?, ?, ?)"
            )
            .bind(nombre)
            .bind(descripcion)
            .bind(color)
            .execute(&self.pool)
            .await?;
        }

        // Insertar keywords base si no existen
        self.initialize_base_keywords().await?;

        Ok(())
    }

    /// Crea un usuario administrador por defecto si no existen usuarios.
    /// Las credenciales se obtienen de (en orden de prioridad):
    /// 1. Variables de entorno en tiempo de ejecución (APP_DEFAULT_ADMIN_USERNAME/PASSWORD)
    /// 2. Variables de entorno en tiempo de compilación (mismo nombre, usando option_env!)
    pub async fn create_default_admin_if_needed(&self) -> Result<(), String> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM usuarios")
            .fetch_one(self.pool())
            .await
            .map_err(|e| format!("Error al contar usuarios: {}", e))?;

        if count > 0 {
            return Ok(());
        }

        let admin_username = std::env::var("APP_DEFAULT_ADMIN_USERNAME")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .or_else(|| option_env!("APP_DEFAULT_ADMIN_USERNAME")
                .map(|s| s.to_string())
                .filter(|v| !v.trim().is_empty()));

        let admin_password = std::env::var("APP_DEFAULT_ADMIN_PASSWORD")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .or_else(|| option_env!("APP_DEFAULT_ADMIN_PASSWORD")
                .map(|s| s.to_string())
                .filter(|v| !v.trim().is_empty()));

        match (admin_username, admin_password) {
            (Some(username), Some(password)) => {
                let (password_hash, salt) = hash_password(&password)?;

                sqlx::query(
                    "INSERT INTO usuarios (username, password_hash, salt, rol) VALUES (?, ?, ?, ?)"
                )
                .bind(&username)
                .bind(&password_hash)
                .bind(&salt)
                .bind("administrador")
                .execute(self.pool())
                .await
                .map_err(|e| format!("Error al crear admin por defecto: {}", e))?;

                println!("Usuario administrador por defecto creado: {}", username);
                Ok(())
            }
            _ => {
                println!("No se creó admin por defecto: faltan APP_DEFAULT_ADMIN_USERNAME/PASSWORD en .env o variables de compilación");
                Ok(())
            }
        }
    }

    /// Inicializa las keywords base para el chatbot
    async fn initialize_base_keywords(&self) -> Result<(), sqlx::Error> {
        let keywords_base = vec![
            // Tecnología
            ("computador", "computador", "producto", Some("Equipos de Cómputo"), "es", None),
            ("computadora", "computadora", "producto", Some("Equipos de Cómputo"), "es", Some("computador")),
            ("computer", "computer", "producto", Some("Equipos de Cómputo"), "en", Some("computador")),
            ("laptop", "laptop", "producto", Some("Equipos de Cómputo"), "es", None),
            ("notebook", "notebook", "producto", Some("Equipos de Cómputo"), "en", Some("laptop")),
            ("pc", "pc", "producto", Some("Equipos de Cómputo"), "es", Some("computador")),
            ("monitor", "monitor", "producto", Some("Equipos de Cómputo"), "es", None),
            ("pantalla", "pantalla", "producto", Some("Equipos de Cómputo"), "es", Some("monitor")),
            ("screen", "screen", "producto", Some("Equipos de Cómputo"), "en", Some("monitor")),
            ("tv", "tv", "producto", Some("Equipos de Telecomunicaciones"), "es", None),
            ("televisor", "televisor", "producto", Some("Equipos de Telecomunicaciones"), "es", Some("tv")),
            ("television", "television", "producto", Some("Equipos de Telecomunicaciones"), "en", Some("tv")),
            ("router", "router", "producto", Some("Equipos de Telecomunicaciones"), "es", None),
            ("switch", "switch", "producto", Some("Equipos de Telecomunicaciones"), "es", None),
            ("impresora", "impresora", "producto", Some("Equipos de Cómputo"), "es", None),
            ("printer", "printer", "producto", Some("Equipos de Cómputo"), "en", Some("impresora")),
            ("teclado", "teclado", "producto", Some("Equipos de Cómputo"), "es", None),
            ("keyboard", "keyboard", "producto", Some("Equipos de Cómputo"), "en", Some("teclado")),
            ("mouse", "mouse", "producto", Some("Equipos de Cómputo"), "es", None),
            ("raton", "raton", "producto", Some("Equipos de Cómputo"), "es", Some("mouse")),
            
            // Mobiliario
            ("silla", "silla", "producto", Some("Mobiliario"), "es", None),
            ("chair", "chair", "producto", Some("Mobiliario"), "en", Some("silla")),
            ("escritorio", "escritorio", "producto", Some("Mobiliario"), "es", None),
            ("desk", "desk", "producto", Some("Mobiliario"), "en", Some("escritorio")),
            ("mesa", "mesa", "producto", Some("Mobiliario"), "es", None),
            ("table", "table", "producto", Some("Mobiliario"), "en", Some("mesa")),
            ("mueble", "mueble", "producto", Some("Mobiliario"), "es", None),
            ("furniture", "furniture", "producto", Some("Mobiliario"), "en", Some("mueble")),
            ("estante", "estante", "producto", Some("Mobiliario"), "es", None),
            ("archivador", "archivador", "producto", Some("Mobiliario"), "es", None),
            
            // Armamento
            ("arma", "arma", "producto", Some("Armamento"), "es", None),
            ("weapon", "weapon", "producto", Some("Armamento"), "en", Some("arma")),
            ("gun", "gun", "producto", Some("Armamento"), "en", Some("arma")),
            ("pistola", "pistola", "producto", Some("Armamento"), "es", None),
            ("pistol", "pistol", "producto", Some("Armamento"), "en", Some("pistola")),
            ("handgun", "handgun", "producto", Some("Armamento"), "en", Some("pistola")),
            ("rifle", "rifle", "producto", Some("Armamento"), "es", None),
            ("fusil", "fusil", "producto", Some("Armamento"), "es", Some("rifle")),
            ("ak", "ak", "producto", Some("Armamento"), "es", None),
            ("ak47", "ak47", "producto", Some("Armamento"), "es", Some("ak")),
            ("ak-47", "ak-47", "producto", Some("Armamento"), "es", Some("ak")),
            ("m16", "m16", "producto", Some("Armamento"), "es", None),
            ("m4", "m4", "producto", Some("Armamento"), "es", None),
            ("escopeta", "escopeta", "producto", Some("Armamento"), "es", None),
            ("shotgun", "shotgun", "producto", Some("Armamento"), "en", Some("escopeta")),
            ("revolver", "revolver", "producto", Some("Armamento"), "es", None),
            ("subametralladora", "subametralladora", "producto", Some("Armamento"), "es", None),
            ("smg", "smg", "producto", Some("Armamento"), "en", Some("subametralladora")),
            ("ametralladora", "ametralladora", "producto", Some("Armamento"), "es", None),
            ("machinegun", "machinegun", "producto", Some("Armamento"), "en", Some("ametralladora")),
            
            // Municiones
            ("municion", "municion", "producto", Some("Municiones"), "es", None),
            ("municiones", "municiones", "producto", Some("Municiones"), "es", Some("municion")),
            ("ammo", "ammo", "producto", Some("Municiones"), "en", Some("municion")),
            ("ammunition", "ammunition", "producto", Some("Municiones"), "en", Some("municion")),
            ("bala", "bala", "producto", Some("Municiones"), "es", None),
            ("balas", "balas", "producto", Some("Municiones"), "es", Some("bala")),
            ("bullet", "bullet", "producto", Some("Municiones"), "en", Some("bala")),
            ("bullets", "bullets", "producto", Some("Municiones"), "en", Some("bala")),
            ("cartucho", "cartucho", "producto", Some("Municiones"), "es", None),
            ("cartuchos", "cartuchos", "producto", Some("Municiones"), "es", Some("cartucho")),
            ("cartridge", "cartridge", "producto", Some("Municiones"), "en", Some("cartucho")),
            ("granada", "granada", "producto", Some("Municiones"), "es", None),
            ("granadas", "granadas", "producto", Some("Municiones"), "es", Some("granada")),
            ("grenade", "grenade", "producto", Some("Municiones"), "en", Some("granada")),
            ("explosivo", "explosivo", "producto", Some("Municiones"), "es", None),
            ("explosive", "explosive", "producto", Some("Municiones"), "en", Some("explosivo")),
            ("proyectil", "proyectil", "producto", Some("Municiones"), "es", None),
            ("calibre", "calibre", "atributo", None, "es", None),
            ("9mm", "9mm", "atributo", Some("Municiones"), "es", None),
            ("5.56", "5.56", "atributo", Some("Municiones"), "es", None),
            ("7.62", "7.62", "atributo", Some("Municiones"), "es", None),
            ("12ga", "12ga", "atributo", Some("Municiones"), "es", None),
            (".45", ".45", "atributo", Some("Municiones"), "es", None),
            
            // Equipamiento táctico
            ("chaleco", "chaleco", "producto", Some("Equipamiento Táctico"), "es", None),
            ("vest", "vest", "producto", Some("Equipamiento Táctico"), "en", Some("chaleco")),
            ("antibalas", "antibalas", "atributo", Some("Equipamiento Táctico"), "es", None),
            ("bulletproof", "bulletproof", "atributo", Some("Equipamiento Táctico"), "en", Some("antibalas")),
            ("casco", "casco", "producto", Some("Equipamiento Táctico"), "es", None),
            ("helmet", "helmet", "producto", Some("Equipamiento Táctico"), "en", Some("casco")),
            ("mochila", "mochila", "producto", Some("Equipamiento Táctico"), "es", None),
            ("backpack", "backpack", "producto", Some("Equipamiento Táctico"), "en", Some("mochila")),
            ("bolso", "bolso", "producto", Some("Equipamiento Táctico"), "es", None),
            ("bag", "bag", "producto", Some("Equipamiento Táctico"), "en", Some("bolso")),
            ("funda", "funda", "producto", Some("Equipamiento Táctico"), "es", None),
            ("holster", "holster", "producto", Some("Equipamiento Táctico"), "en", Some("funda")),
            ("cinturon", "cinturon", "producto", Some("Equipamiento Táctico"), "es", None),
            ("belt", "belt", "producto", Some("Equipamiento Táctico"), "en", Some("cinturon")),
            ("botas", "botas", "producto", Some("Equipamiento Táctico"), "es", None),
            ("boots", "boots", "producto", Some("Equipamiento Táctico"), "en", Some("botas")),
            ("uniforme", "uniforme", "producto", Some("Equipamiento Táctico"), "es", None),
            ("uniform", "uniform", "producto", Some("Equipamiento Táctico"), "en", Some("uniforme")),
            ("guantes", "guantes", "producto", Some("Equipamiento Táctico"), "es", None),
            ("gloves", "gloves", "producto", Some("Equipamiento Táctico"), "en", Some("guantes")),
            ("lentes", "lentes", "producto", Some("Equipamiento Táctico"), "es", None),
            ("goggles", "goggles", "producto", Some("Equipamiento Táctico"), "en", Some("lentes")),
            ("gafas", "gafas", "producto", Some("Equipamiento Táctico"), "es", Some("lentes")),
            ("rodilleras", "rodilleras", "producto", Some("Equipamiento Táctico"), "es", None),
            ("coderas", "coderas", "producto", Some("Equipamiento Táctico"), "es", None),
            
            // Vehículos
            ("vehiculo", "vehiculo", "producto", Some("Vehículos"), "es", None),
            ("vehicle", "vehicle", "producto", Some("Vehículos"), "en", Some("vehiculo")),
            ("carro", "carro", "producto", Some("Vehículos"), "es", None),
            ("car", "car", "producto", Some("Vehículos"), "en", Some("carro")),
            ("camioneta", "camioneta", "producto", Some("Vehículos"), "es", None),
            ("truck", "truck", "producto", Some("Vehículos"), "en", Some("camioneta")),
            ("moto", "moto", "producto", Some("Vehículos"), "es", None),
            ("motocicleta", "motocicleta", "producto", Some("Vehículos"), "es", Some("moto")),
            ("motorcycle", "motorcycle", "producto", Some("Vehículos"), "en", Some("moto")),
            ("camion", "camion", "producto", Some("Vehículos"), "es", None),
            ("blindado", "blindado", "producto", Some("Vehículos"), "es", None),
            ("armored", "armored", "producto", Some("Vehículos"), "en", Some("blindado")),
            
            // Comunicaciones
            ("radio", "radio", "producto", Some("Comunicaciones"), "es", None),
            ("walkie", "walkie", "producto", Some("Comunicaciones"), "es", None),
            ("walkietalkie", "walkietalkie", "producto", Some("Comunicaciones"), "es", Some("walkie")),
            ("antena", "antena", "producto", Some("Comunicaciones"), "es", None),
            ("antenna", "antenna", "producto", Some("Comunicaciones"), "en", Some("antena")),
            ("transmisor", "transmisor", "producto", Some("Comunicaciones"), "es", None),
            ("transmitter", "transmitter", "producto", Some("Comunicaciones"), "en", Some("transmisor")),
            ("receptor", "receptor", "producto", Some("Comunicaciones"), "es", None),
            ("receiver", "receiver", "producto", Some("Comunicaciones"), "en", Some("receptor")),
            
            // Equipos médicos
            ("botiquin", "botiquin", "producto", Some("Equipos Médicos"), "es", None),
            ("medkit", "medkit", "producto", Some("Equipos Médicos"), "en", Some("botiquin")),
            ("firstaid", "firstaid", "producto", Some("Equipos Médicos"), "en", Some("botiquin")),
            ("camilla", "camilla", "producto", Some("Equipos Médicos"), "es", None),
            ("stretcher", "stretcher", "producto", Some("Equipos Médicos"), "en", Some("camilla")),
            ("desfibrilador", "desfibrilador", "producto", Some("Equipos Médicos"), "es", None),
            ("defibrillator", "defibrillator", "producto", Some("Equipos Médicos"), "en", Some("desfibrilador")),
            ("aed", "aed", "producto", Some("Equipos Médicos"), "en", Some("desfibrilador")),
            ("vendaje", "vendaje", "producto", Some("Equipos Médicos"), "es", None),
            ("bandage", "bandage", "producto", Some("Equipos Médicos"), "en", Some("vendaje")),
            ("torniquete", "torniquete", "producto", Some("Equipos Médicos"), "es", None),
            ("tourniquet", "tourniquet", "producto", Some("Equipos Médicos"), "en", Some("torniquete")),
            
            // Herramientas
            ("herramienta", "herramienta", "producto", Some("Herramientas"), "es", None),
            ("tool", "tool", "producto", Some("Herramientas"), "en", Some("herramienta")),
            ("tools", "tools", "producto", Some("Herramientas"), "en", Some("herramienta")),
            ("martillo", "martillo", "producto", Some("Herramientas"), "es", None),
            ("hammer", "hammer", "producto", Some("Herramientas"), "en", Some("martillo")),
            ("destornillador", "destornillador", "producto", Some("Herramientas"), "es", None),
            ("screwdriver", "screwdriver", "producto", Some("Herramientas"), "en", Some("destornillador")),
            ("taladro", "taladro", "producto", Some("Herramientas"), "es", None),
            ("drill", "drill", "producto", Some("Herramientas"), "en", Some("taladro")),
            ("sierra", "sierra", "producto", Some("Herramientas"), "es", None),
            ("saw", "saw", "producto", Some("Herramientas"), "en", Some("sierra")),
            ("llave", "llave", "producto", Some("Herramientas"), "es", None),
            ("wrench", "wrench", "producto", Some("Herramientas"), "en", Some("llave")),
            ("alicate", "alicate", "producto", Some("Herramientas"), "es", None),
            ("pliers", "pliers", "producto", Some("Herramientas"), "en", Some("alicate")),
            ("cinta", "cinta", "producto", Some("Herramientas"), "es", None),
            ("tape", "tape", "producto", Some("Herramientas"), "en", Some("cinta")),
            
            // Marcas comunes
            ("lg", "lg", "marca", None, "es", None),
            ("samsung", "samsung", "marca", None, "es", None),
            ("sony", "sony", "marca", None, "es", None),
            ("dell", "dell", "marca", None, "es", None),
            ("hp", "hp", "marca", None, "es", None),
            ("lenovo", "lenovo", "marca", None, "es", None),
            ("asus", "asus", "marca", None, "es", None),
            ("acer", "acer", "marca", None, "es", None),
            ("apple", "apple", "marca", None, "es", None),
            ("microsoft", "microsoft", "marca", None, "es", None),
            ("glock", "glock", "marca", Some("Armamento"), "es", None),
            ("beretta", "beretta", "marca", Some("Armamento"), "es", None),
            ("colt", "colt", "marca", Some("Armamento"), "es", None),
            ("sig", "sig", "marca", Some("Armamento"), "es", None),
            ("sigsauer", "sigsauer", "marca", Some("Armamento"), "es", Some("sig")),
            ("remington", "remington", "marca", Some("Armamento"), "es", None),
            ("mossberg", "mossberg", "marca", Some("Armamento"), "es", None),
            ("hk", "hk", "marca", Some("Armamento"), "es", None),
            ("heckler", "heckler", "marca", Some("Armamento"), "es", Some("hk")),
            ("motorola", "motorola", "marca", Some("Comunicaciones"), "es", None),
            ("kenwood", "kenwood", "marca", Some("Comunicaciones"), "es", None),
            
            // Estados
            ("operativo", "operativo", "estado", None, "es", None),
            ("operational", "operational", "estado", None, "en", Some("operativo")),
            ("working", "working", "estado", None, "en", Some("operativo")),
            ("funcionando", "funcionando", "estado", None, "es", Some("operativo")),
            ("mantenimiento", "mantenimiento", "estado", None, "es", None),
            ("maintenance", "maintenance", "estado", None, "en", Some("mantenimiento")),
            ("reparacion", "reparacion", "estado", None, "es", None),
            ("repair", "repair", "estado", None, "en", Some("reparacion")),
            ("dañado", "danado", "estado", None, "es", None),
            ("damaged", "damaged", "estado", None, "en", Some("dañado")),
            ("vencido", "vencido", "estado", None, "es", None),
            ("expired", "expired", "estado", None, "en", Some("vencido")),
            ("nuevo", "nuevo", "estado", None, "es", None),
            ("new", "new", "estado", None, "en", Some("nuevo")),
            ("usado", "usado", "estado", None, "es", None),
            ("used", "used", "estado", None, "en", Some("usado")),
            
            // Acciones de búsqueda
            ("busco", "busco", "accion", None, "es", None),
            ("buscar", "buscar", "accion", None, "es", Some("busco")),
            ("search", "search", "accion", None, "en", Some("busco")),
            ("find", "find", "accion", None, "en", Some("busco")),
            ("necesito", "necesito", "accion", None, "es", None),
            ("need", "need", "accion", None, "en", Some("necesito")),
            ("quiero", "quiero", "accion", None, "es", None),
            ("want", "want", "accion", None, "en", Some("quiero")),
            ("muestra", "muestra", "accion", None, "es", None),
            ("show", "show", "accion", None, "en", Some("muestra")),
            ("mostrar", "mostrar", "accion", None, "es", Some("muestra")),
            ("ver", "ver", "accion", None, "es", None),
            ("see", "see", "accion", None, "en", Some("ver")),
            ("listar", "listar", "accion", None, "es", None),
            ("list", "list", "accion", None, "en", Some("listar")),
        ];

        for (palabra, normalizada, tipo, categoria, idioma, sinonimo) in keywords_base {
            let _ = sqlx::query(
                r#"
                INSERT OR IGNORE INTO keywords 
                (palabra, palabra_normalizada, tipo, categoria_asociada, idioma, es_sinonimo_de) 
                VALUES (?, ?, ?, ?, ?, ?)
                "#
            )
            .bind(palabra)
            .bind(normalizada)
            .bind(tipo)
            .bind(categoria)
            .bind(idioma)
            .bind(sinonimo)
            .execute(&self.pool)
            .await;
        }

        Ok(())
    }

    /// Registra una acción en la auditoría
    /// base_datos_id es opcional: para acciones sobre activos se setea, para otras (login, users) puede ser None
    pub async fn log_audit(
        &self,
        usuario_id: i64,
        accion: &str,
        tabla: &str,
        registro_id: i64,
        datos_anteriores: Option<&str>,
        datos_nuevos: Option<&str>,
        base_datos_id: Option<i64>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO auditoria (usuario_id, accion, tabla, registro_id, datos_anteriores, datos_nuevos, base_datos_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(usuario_id)
        .bind(accion)
        .bind(tabla)
        .bind(registro_id)
        .bind(datos_anteriores)
        .bind(datos_nuevos)
        .bind(base_datos_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Verifica si un usuario tiene acceso a una base_datos específica
    pub async fn check_base_datos_access(
        &self,
        user_id: i64,
        base_datos_id: i64,
    ) -> Result<bool, sqlx::Error> {
        let rol: String = sqlx::query_scalar("SELECT rol FROM usuarios WHERE id = ?")
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(sqlx::Error::Protocol("Usuario no encontrado".to_string()))?;

        if rol == "administrador" {
            return Ok(true);
        }

        let has_access: bool = sqlx::query_scalar(
            "SELECT COUNT(*) > 0 FROM usuario_base_datos WHERE usuario_id = ? AND base_datos_id = ?"
        )
        .bind(user_id)
        .bind(base_datos_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(has_access)
    }

    /// Obtiene los IDs de bases_datos a los que un usuario tiene acceso
    /// (todas para admin, o las asignadas para otros roles)
    pub async fn get_user_base_datos_ids(
        &self,
        user_id: i64,
    ) -> Result<Vec<i64>, sqlx::Error> {
        let rol: String = sqlx::query_scalar("SELECT rol FROM usuarios WHERE id = ?")
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(sqlx::Error::Protocol("Usuario no encontrado".to_string()))?;

        if rol == "administrador" {
            let rows: Vec<i64> = sqlx::query_scalar("SELECT id FROM bases_datos")
                .fetch_all(&self.pool)
                .await?;
            return Ok(rows);
        }

        let rows: Vec<i64> = sqlx::query_scalar(
            "SELECT base_datos_id FROM usuario_base_datos WHERE usuario_id = ?"
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    /// Obtiene una referencia al pool de conexiones
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}
