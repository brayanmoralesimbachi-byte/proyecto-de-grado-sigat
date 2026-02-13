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
            .pragma("key", encryption_key.to_string()) // Clave de cifrado para SQLCipher
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
                imagen_base64 TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (responsable_id) REFERENCES usuarios(id)
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

        // Migración: Agregar columna imagen_base64 si no existe
        // Verificar si la columna existe
        let table_info: Vec<(i64, String, String, i64, Option<String>, i64)> = sqlx::query_as(
            "PRAGMA table_info(activos)"
        )
        .fetch_all(&self.pool)
        .await?;

        let has_imagen_column = table_info.iter().any(|(_, name, _, _, _, _)| name == "imagen_base64");

        if !has_imagen_column {
            // Agregar la columna imagen_base64 a la tabla existente
            sqlx::query("ALTER TABLE activos ADD COLUMN imagen_base64 TEXT")
                .execute(&self.pool)
                .await?;
        }

        Ok(())
    }

    /// Registra una acción en la auditoría
    pub async fn log_audit(
        &self,
        usuario_id: i64,
        accion: &str,
        tabla: &str,
        registro_id: i64,
        datos_anteriores: Option<&str>,
        datos_nuevos: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO auditoria (usuario_id, accion, tabla, registro_id, datos_anteriores, datos_nuevos)
            VALUES (?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(usuario_id)
        .bind(accion)
        .bind(tabla)
        .bind(registro_id)
        .bind(datos_anteriores)
        .bind(datos_nuevos)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Obtiene una referencia al pool de conexiones
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}
