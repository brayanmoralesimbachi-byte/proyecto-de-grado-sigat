use crate::crypto::{hash_password, verify_password};
use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::sync::Mutex;
use std::sync::Mutex as StdMutex;
use sqlx::Row;
use std::io::BufReader;
use rand::Rng;
use sevenz_rust::SevenZReader;
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Información de intentos de login para rate limiting
#[derive(Clone, Debug)]
pub struct LoginAttemptInfo {
    pub count: u32,
    pub blocked_until: Option<Instant>,
}

/// Estado compartido de la aplicación
pub struct AppState {
    pub db: Mutex<Option<crate::db::Database>>,
    pub can_close_app: StdMutex<bool>,
    pub active_user_id: StdMutex<Option<i64>>,
    pub login_timestamp: StdMutex<Option<String>>,
    pub login_attempts: StdMutex<HashMap<String, LoginAttemptInfo>>,
}

/// Estructura para el login de usuario
#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

/// Estructura para la respuesta de login
#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub success: bool,
    pub message: String,
    pub user_id: Option<i64>,
    pub username: Option<String>,
    pub rol: Option<String>,
    pub timezone: Option<String>,
    pub blocked_until: Option<String>, // Timestamp RFC 3339 hasta el que está bloqueado
}

#[tauri::command]
pub async fn create_user(
    username: String,
    password: String,
    rol: String,
    base_datos_ids: Option<Vec<i64>>,
    admin_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let exists: bool = sqlx::query_scalar("SELECT COUNT(*) > 0 FROM usuarios WHERE username = ?")
        .bind(&username)
        .fetch_one(db.pool())
        .await
        .map_err(|e| format!("Error al verificar usuario: {}", e))?;

    if exists {
        return Err("El nombre de usuario ya está en uso. Por favor, intente con otro nombre de usuario.".to_string());
    }

    let (password_hash, salt) = hash_password(&password)?;

    sqlx::query(
        r#"
        INSERT INTO usuarios (username, password_hash, salt, rol)
        VALUES (?, ?, ?, ?)
        "#,
    )
    .bind(&username)
    .bind(&password_hash)
    .bind(&salt)
    .bind(&rol)
    .execute(db.pool())
    .await
    .map_err(|e| format!("Error al crear usuario: {}", e))?;

    let user_id = sqlx::query_scalar::<_, i64>("SELECT id FROM usuarios WHERE username = ?")
        .bind(&username)
        .fetch_one(db.pool())
        .await
        .map_err(|e| format!("Error al obtener usuario creado: {}", e))?;

    if let Some(ref ids) = base_datos_ids {
        for bd_id in ids {
            sqlx::query("INSERT INTO usuario_base_datos (usuario_id, base_datos_id) VALUES (?, ?)")
                .bind(user_id)
                .bind(bd_id)
                .execute(db.pool())
                .await
                .map_err(|e| format!("Error al asignar base de datos: {}", e))?;
        }
    }

    if let Some(aid) = admin_id {
        db.log_audit(aid, "CREATE", "usuarios", user_id, None, Some(&format!("Usuario creado: {}, rol: {}", username, rol)), None)
            .await
            .map_err(|e| format!("Error al registrar auditoría: {}", e))?;
    }

    Ok(format!("Usuario {} creado exitosamente", username))
}

/// Comando Tauri para autenticar un usuario con rate limiting
#[tauri::command]
pub async fn login(
    request: LoginRequest,
    state: State<'_, AppState>,
) -> Result<LoginResponse, String> {
    // Rate limiting: 5 intentos fallidos → bloqueo de 5 minutos
    {
        let mut attempts = state.login_attempts.lock().unwrap();
        let now = Instant::now();

        if let Some(info) = attempts.get(&request.username) {
            // Verificar si está bloqueado
            if let Some(blocked_until) = info.blocked_until {
                if now < blocked_until {
                    let blocked_str = chrono::Utc::now() + chrono::Duration::seconds(
                        blocked_until.duration_since(now).as_secs() as i64
                    );
                    return Ok(LoginResponse {
                        success: false,
                        message: "Demasiados intentos. Intente de nuevo en 5 minutos.".to_string(),
                        user_id: None,
                        username: None,
                        rol: None,
                        timezone: None,
                        blocked_until: Some(blocked_str.to_rfc3339()),
                    });
                } else {
                    // Bloqueo expirado, reiniciar contador
                    attempts.remove(&request.username);
                }
            }
        }
    }

    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let user: Option<(i64, String, String, String, Option<String>)> = sqlx::query_as(
        r#"
        SELECT id, username, password_hash, rol, timezone
        FROM usuarios
        WHERE username = ?
        "#,
    )
    .bind(&request.username)
    .fetch_optional(db.pool())
    .await
    .map_err(|e| format!("Error al buscar usuario: {}", e))?;

    if let Some((user_id, username, password_hash, rol, timezone)) = user {
        if verify_password(&request.password, &password_hash)? {
            // Login exitoso: limpiar intentos
            state.login_attempts.lock().unwrap().remove(&request.username);

            db.log_audit(user_id, "LOGIN", "usuarios", user_id, None, None, None)
                .await
                .map_err(|e| format!("Error al registrar auditoría: {}", e))?;

            let login_time = chrono::Utc::now().to_rfc3339();
            *state.can_close_app.lock().unwrap() = false;
            *state.active_user_id.lock().unwrap() = Some(user_id);
            *state.login_timestamp.lock().unwrap() = Some(login_time.clone());

            Ok(LoginResponse {
                success: true,
                message: "Login exitoso".to_string(),
                user_id: Some(user_id),
                username: Some(username),
                rol: Some(rol),
                timezone,
                blocked_until: None,
            })
        } else {
            // Fallo: incrementar contador y posiblemente bloquear
            let mut attempts = state.login_attempts.lock().unwrap();
            let info = attempts.entry(request.username.clone()).or_insert(LoginAttemptInfo {
                count: 0,
                blocked_until: None,
            });
            info.count += 1;
            if info.count >= 5 {
                info.blocked_until = Some(Instant::now() + Duration::from_secs(300)); // 5 minutos
            }

            Ok(LoginResponse {
                success: false,
                message: "Credenciales inválidas".to_string(),
                user_id: None,
                username: None,
                rol: None,
                timezone: None,
                blocked_until: info.blocked_until.map(|_| {
                    (chrono::Utc::now() + chrono::Duration::seconds(300)).to_rfc3339()
                }),
            })
        }
    } else {
        // Usuario no existe: igual registrar intento para no revelar existencia
        let mut attempts = state.login_attempts.lock().unwrap();
        let info = attempts.entry(request.username.clone()).or_insert(LoginAttemptInfo {
            count: 0,
            blocked_until: None,
        });
        info.count += 1;
        if info.count >= 5 {
            info.blocked_until = Some(Instant::now() + Duration::from_secs(300));
        }

        Ok(LoginResponse {
            success: false,
            message: "Credenciales inválidas".to_string(),
            user_id: None,
            username: None,
            rol: None,
            timezone: None,
            blocked_until: info.blocked_until.map(|_| {
                (chrono::Utc::now() + chrono::Duration::seconds(300)).to_rfc3339()
            }),
        })
    }
}

/// Comando Tauri para cerrar sesión
#[tauri::command]
pub async fn logout(
    user_id: i64,
    login_timestamp: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    // Calcular duración de sesión
    let login_time = chrono::DateTime::parse_from_rfc3339(&login_timestamp)
        .map_err(|e| format!("Error al parsear timestamp: {}", e))?;
    let logout_time = chrono::Utc::now();
    let duration = logout_time.signed_duration_since(login_time);
    
    let hours = duration.num_hours();
    let minutes = duration.num_minutes() % 60;
    let seconds = duration.num_seconds() % 60;
    
    let session_duration = format!("{}h {}m {}s", hours, minutes, seconds);
    let logout_message = format!("Sesión finalizada. Duración: {}", session_duration);

    db.log_audit(user_id, "LOGOUT", "usuarios", user_id, None, Some(&logout_message), None)
        .await
        .map_err(|e| format!("Error al registrar auditoría: {}", e))?;

    // Permitir cierre de app y limpiar sesión
    *state.can_close_app.lock().unwrap() = true;
    *state.active_user_id.lock().unwrap() = None;
    *state.login_timestamp.lock().unwrap() = None;

    Ok(logout_message)
}

/// Comando para obtener el estado de cierre de la aplicación
#[tauri::command]
pub async fn can_close_app(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(*state.can_close_app.lock().unwrap())
}

/// Comando para forzar logout en caso de cierre forzoso
#[tauri::command]
pub async fn force_logout(state: State<'_, AppState>) -> Result<String, String> {
    let user_id_opt = *state.active_user_id.lock().unwrap();
    let login_timestamp_opt = state.login_timestamp.lock().unwrap().clone();

    if let (Some(user_id), Some(login_timestamp)) = (user_id_opt, login_timestamp_opt) {
        let db_lock = state.db.lock().await;
        if let Some(db) = db_lock.as_ref() {
            // Calcular duración de sesión
            if let Ok(login_time) = chrono::DateTime::parse_from_rfc3339(&login_timestamp) {
                let logout_time = chrono::Utc::now();
                let duration = logout_time.signed_duration_since(login_time);
                
                let hours = duration.num_hours();
                let minutes = duration.num_minutes() % 60;
                let seconds = duration.num_seconds() % 60;
                
                let session_duration = format!("{}h {}m {}s", hours, minutes, seconds);
                let logout_message = format!("Sesión finalizada forzosamente (cierre de aplicación). Duración: {}", session_duration);

                // Registrar auditoría de logout forzoso
                let _ = db.log_audit(user_id, "LOGOUT", "usuarios", user_id, None, Some(&logout_message), None).await;
            }
        }

        // Permitir cierre de app
        *state.can_close_app.lock().unwrap() = true;
        *state.active_user_id.lock().unwrap() = None;
        *state.login_timestamp.lock().unwrap() = None;

        return Ok("Logout forzoso registrado".to_string());
    }

    Ok("No hay sesión activa".to_string())
}

#[tauri::command]
pub async fn get_activos(
    user_id: Option<i64>,
    base_datos_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let base_ids = if let Some(uid) = user_id {
        db.get_user_base_datos_ids(uid)
            .await
            .map_err(|e| format!("Error al obtener bases de datos: {}", e))?
    } else {
        // No user specified: return all activos
        sqlx::query_scalar("SELECT id FROM bases_datos")
            .fetch_all(db.pool())
            .await
            .map_err(|e| format!("Error al obtener bases de datos: {}", e))?
    };

    let activos = if let Some(filter_bd_id) = base_datos_id {
        // Filter by a specific base_datos
        sqlx::query(
            r#"
            SELECT a.id, a.codigo, a.nombre, a.descripcion, a.categoria, a.ubicacion, 
                   a.responsable_id, a.estado, a.valor_adquisicion, a.fecha_adquisicion, 
                   a.fecha_vencimiento, a.imagen_base64, a.palabras_clave, a.created_by, a.created_at,
                   b.nombre as base_datos_nombre
            FROM activos a
            LEFT JOIN bases_datos b ON a.base_datos_id = b.id
            WHERE a.base_datos_id = ?
            ORDER BY a.codigo
            "#,
        )
        .bind(filter_bd_id)
        .fetch_all(db.pool())
        .await
        .map_err(|e| format!("Error al obtener activos: {}", e))?
    } else {
        if base_ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut query = String::from(
            r#"
            SELECT a.id, a.codigo, a.nombre, a.descripcion, a.categoria, a.ubicacion, 
                   a.responsable_id, a.estado, a.valor_adquisicion, a.fecha_adquisicion, 
                   a.fecha_vencimiento, a.imagen_base64, a.palabras_clave, a.created_by, a.created_at,
                   b.nombre as base_datos_nombre
            FROM activos a
            LEFT JOIN bases_datos b ON a.base_datos_id = b.id
            WHERE a.base_datos_id IN ("#
        );
        let placeholders: Vec<String> = base_ids.iter().map(|_| "?".to_string()).collect();
        query.push_str(&placeholders.join(", "));
        query.push_str(") ORDER BY a.codigo");

        let mut q = sqlx::query(&query);
        for id in &base_ids {
            q = q.bind(id);
        }
        q.fetch_all(db.pool())
            .await
            .map_err(|e| format!("Error al obtener activos: {}", e))?
    };

    let mut result = Vec::new();
    for row in activos {
        let json = serde_json::json!({
            "id": row.try_get::<i64, _>("id").ok(),
            "codigo": row.try_get::<String, _>("codigo").ok(),
            "nombre": row.try_get::<String, _>("nombre").ok(),
            "descripcion": row.try_get::<Option<String>, _>("descripcion").ok().flatten(),
            "categoria": row.try_get::<String, _>("categoria").ok(),
            "ubicacion": row.try_get::<Option<String>, _>("ubicacion").ok().flatten(),
            "responsable_id": row.try_get::<Option<i64>, _>("responsable_id").ok().flatten(),
            "estado": row.try_get::<String, _>("estado").ok(),
            "valor_adquisicion": row.try_get::<Option<f64>, _>("valor_adquisicion").ok().flatten(),
            "fecha_adquisicion": row.try_get::<Option<String>, _>("fecha_adquisicion").ok().flatten(),
            "fecha_vencimiento": row.try_get::<Option<String>, _>("fecha_vencimiento").ok().flatten(),
            "imagen_base64": row.try_get::<Option<String>, _>("imagen_base64").ok().flatten(),
            "palabras_clave": row.try_get::<Option<String>, _>("palabras_clave").ok().flatten(),
            "created_by": row.try_get::<Option<i64>, _>("created_by").ok().flatten(),
            "created_at": row.try_get::<Option<String>, _>("created_at").ok().flatten(),
            "base_datos_nombre": row.try_get::<Option<String>, _>("base_datos_nombre").ok().flatten(),
        });
        result.push(json);
    }

    Ok(result)
}

/// Estructura para crear/actualizar activos
#[derive(Debug, Deserialize)]
pub struct ActivoInput {
    pub codigo: String,
    pub nombre: String,
    pub descripcion: Option<String>,
    pub categoria: String,
    pub ubicacion: Option<String>,
    pub responsable_id: Option<i64>,
    pub base_datos_id: i64,
    pub estado: String,
    pub valor_adquisicion: Option<f64>,
    pub fecha_adquisicion: Option<String>,
    pub fecha_vencimiento: Option<String>,
    pub imagen_base64: Option<String>,
    pub palabras_clave: Option<String>,
}

/// Comando para crear un nuevo activo
#[tauri::command]
pub async fn create_activo(
    activo: ActivoInput,
    user_id: i64,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let result = sqlx::query(
        r#"
        INSERT INTO activos (codigo, nombre, descripcion, categoria, ubicacion, 
                            responsable_id, base_datos_id, estado, valor_adquisicion, fecha_adquisicion, 
                            fecha_vencimiento, imagen_base64, palabras_clave, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&activo.codigo)
    .bind(&activo.nombre)
    .bind(&activo.descripcion)
    .bind(&activo.categoria)
    .bind(&activo.ubicacion)
    .bind(&activo.responsable_id)
    .bind(activo.base_datos_id)
    .bind(&activo.estado)
    .bind(&activo.valor_adquisicion)
    .bind(&activo.fecha_adquisicion)
    .bind(&activo.fecha_vencimiento)
    .bind(&activo.imagen_base64)
    .bind(&activo.palabras_clave)
    .bind(user_id)
    .execute(db.pool())
    .await
    .map_err(|e| format!("Error al crear activo: {}", e))?;

    let activo_id = result.last_insert_rowid();

    // Registrar auditoría
    db.log_audit(user_id, "CREATE", "activos", activo_id, None, Some(&format!("Creado activo: {}", activo.nombre)), Some(activo.base_datos_id))
        .await
        .map_err(|e| format!("Error al registrar auditoría: {}", e))?;

    Ok(activo_id)
}

/// Comando para actualizar un activo
#[tauri::command]
pub async fn update_activo(
    id: i64,
    activo: ActivoInput,
    user_id: i64,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let old_values = sqlx::query(
        "SELECT codigo, nombre, categoria, estado, base_datos_id FROM activos WHERE id = ?"
    )
    .bind(id)
    .fetch_optional(db.pool())
    .await
    .map_err(|e| format!("Error al obtener activo: {}", e))?;

    sqlx::query(
        r#"
        UPDATE activos 
        SET codigo = ?, nombre = ?, descripcion = ?, categoria = ?, ubicacion = ?,
            responsable_id = ?, estado = ?, valor_adquisicion = ?, fecha_adquisicion = ?, 
            fecha_vencimiento = ?, imagen_base64 = ?, palabras_clave = ?
        WHERE id = ?
        "#,
    )
    .bind(&activo.codigo)
    .bind(&activo.nombre)
    .bind(&activo.descripcion)
    .bind(&activo.categoria)
    .bind(&activo.ubicacion)
    .bind(&activo.responsable_id)
    .bind(&activo.estado)
    .bind(&activo.valor_adquisicion)
    .bind(&activo.fecha_adquisicion)
    .bind(&activo.fecha_vencimiento)
    .bind(&activo.imagen_base64)
    .bind(&activo.palabras_clave)
    .bind(id)
    .execute(db.pool())
    .await
    .map_err(|e| format!("Error al actualizar activo: {}", e))?;

    // Registrar auditoría
    if let Some(old_row) = old_values {
        let old_nombre: String = old_row.try_get("nombre").unwrap_or_default();
        let bd_id: Option<i64> = old_row.try_get("base_datos_id").ok().flatten();
        db.log_audit(user_id, "UPDATE", "activos", id, Some(&old_nombre), Some(&activo.nombre), bd_id)
            .await
            .map_err(|e| format!("Error al registrar auditoría: {}", e))?;
    }

    Ok("Activo actualizado exitosamente".to_string())
}

/// Comando para eliminar un activo
#[tauri::command]
pub async fn delete_activo(
    id: i64,
    user_id: i64,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let activo_info: Option<(String, Option<i64>)> = sqlx::query_as(
        "SELECT nombre, base_datos_id FROM activos WHERE id = ?"
    )
    .bind(id)
    .fetch_optional(db.pool())
    .await
    .map_err(|e| format!("Error al obtener activo: {}", e))?;

    sqlx::query("DELETE FROM activos WHERE id = ?")
        .bind(id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al eliminar activo: {}", e))?;

    if let Some((nombre, bd_id)) = activo_info {
        db.log_audit(user_id, "DELETE", "activos", id, Some(&nombre), None, bd_id)
            .await
            .map_err(|e| format!("Error al registrar auditoría: {}", e))?;
    }

    Ok("Activo eliminado exitosamente".to_string())
}

/// Comando para obtener todos los usuarios (solo administradores)
#[tauri::command]
pub async fn get_users(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let users = sqlx::query(
        r#"
        SELECT id, username, rol, created_at
        FROM usuarios
        ORDER BY created_at DESC
        "#,
    )
    .fetch_all(db.pool())
    .await
    .map_err(|e| format!("Error al obtener usuarios: {}", e))?;

    let mut result = Vec::new();
    for row in users {
        let json = serde_json::json!({
            "id": row.try_get::<i64, _>("id").ok(),
            "username": row.try_get::<String, _>("username").ok(),
            "rol": row.try_get::<String, _>("rol").ok(),
            "created_at": row.try_get::<String, _>("created_at").ok(),
        });
        result.push(json);
    }

    Ok(result)
}

/// Comando para actualizar rol de usuario
#[tauri::command]
pub async fn update_user_role(
    user_id: i64,
    new_role: String,
    admin_id: i64,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    sqlx::query("UPDATE usuarios SET rol = ? WHERE id = ?")
        .bind(&new_role)
        .bind(user_id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al actualizar rol: {}", e))?;

    db.log_audit(admin_id, "UPDATE", "usuarios", user_id, None, Some(&format!("Rol cambiado a: {}", new_role)), None)
        .await
        .map_err(|e| format!("Error al registrar auditoría: {}", e))?;

    Ok("Rol actualizado exitosamente".to_string())
}

/// Comando para eliminar usuario
#[tauri::command]
pub async fn delete_user(
    user_id: i64,
    admin_id: i64,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    // Obtener username para auditoría
    let username: Option<String> = sqlx::query_scalar("SELECT username FROM usuarios WHERE id = ?")
        .bind(user_id)
        .fetch_optional(db.pool())
        .await
        .map_err(|e| format!("Error al obtener usuario: {}", e))?;

    // Eliminar registros relacionados antes de eliminar el usuario
    sqlx::query("DELETE FROM usuario_base_datos WHERE usuario_id = ?")
        .bind(user_id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al eliminar asignaciones: {}", e))?;

    sqlx::query("DELETE FROM auditoria WHERE usuario_id = ?")
        .bind(user_id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al eliminar registros de auditoría: {}", e))?;

    sqlx::query("DELETE FROM activo_vistas WHERE usuario_id = ?")
        .bind(user_id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al eliminar vistas de activos: {}", e))?;

    sqlx::query("DELETE FROM username_history WHERE user_id = ?")
        .bind(user_id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al eliminar historial de nombres: {}", e))?;

    sqlx::query("UPDATE activos SET responsable_id = NULL WHERE responsable_id = ?")
        .bind(user_id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al actualizar activos (responsable): {}", e))?;

    sqlx::query("UPDATE activos SET created_by = NULL WHERE created_by = ?")
        .bind(user_id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al actualizar activos (created_by): {}", e))?;

    sqlx::query("DELETE FROM usuarios WHERE id = ?")
        .bind(user_id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al eliminar usuario: {}", e))?;

    // Registrar auditoría
    if let Some(name) = username {
        db.log_audit(admin_id, "DELETE", "usuarios", user_id, Some(&name), None, None)
            .await
            .map_err(|e| format!("Error al registrar auditoría: {}", e))?;
    }

    Ok("Usuario eliminado exitosamente".to_string())
}

#[tauri::command]
pub async fn get_audit_log(
    user_id: Option<i64>,
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let limit_value = limit.unwrap_or(100);

    let logs = if let Some(uid) = user_id {
        let user_rol: String = sqlx::query_scalar("SELECT rol FROM usuarios WHERE id = ?")
            .bind(uid)
            .fetch_one(db.pool())
            .await
            .map_err(|e| format!("Error al verificar rol: {}", e))?;

        if user_rol == "administrador" {
            sqlx::query(
                r#"
                SELECT a.id, a.usuario_id as user_id, u.username, a.accion as action, a.tabla as table_name, 
                       a.registro_id as record_id, a.datos_anteriores as old_value, a.datos_nuevos as new_value, a.timestamp,
                       a.base_datos_id
                FROM auditoria a
                LEFT JOIN usuarios u ON a.usuario_id = u.id
                ORDER BY a.timestamp DESC
                LIMIT ?
                "#,
            )
            .bind(limit_value)
            .fetch_all(db.pool())
            .await
            .map_err(|e| format!("Error al obtener log de auditoría: {}", e))?
        } else {
            let base_ids = db.get_user_base_datos_ids(uid)
                .await
                .map_err(|e| format!("Error al obtener bases de datos: {}", e))?;

            if base_ids.is_empty() {
                return Ok(Vec::new());
            }

            let mut query = String::from(
                r#"
                SELECT a.id, a.usuario_id as user_id, u.username, a.accion as action, a.tabla as table_name, 
                       a.registro_id as record_id, a.datos_anteriores as old_value, a.datos_nuevos as new_value, a.timestamp,
                       a.base_datos_id
                FROM auditoria a
                LEFT JOIN usuarios u ON a.usuario_id = u.id
                WHERE a.base_datos_id IN ("#
            );
            let placeholders: Vec<String> = base_ids.iter().map(|_| "?".to_string()).collect();
            query.push_str(&placeholders.join(", "));
            query.push_str(") ORDER BY a.timestamp DESC LIMIT ?");

            let mut q = sqlx::query(&query);
            for id in &base_ids {
                q = q.bind(id);
            }
            q.bind(limit_value)
                .fetch_all(db.pool())
                .await
                .map_err(|e| format!("Error al obtener log de auditoría: {}", e))?
        }
    } else {
        // No user_id provided: return all logs (fallback for chatbot etc.)
        sqlx::query(
            r#"
            SELECT a.id, a.usuario_id as user_id, u.username, a.accion as action, a.tabla as table_name, 
                   a.registro_id as record_id, a.datos_anteriores as old_value, a.datos_nuevos as new_value, a.timestamp,
                   a.base_datos_id
            FROM auditoria a
            LEFT JOIN usuarios u ON a.usuario_id = u.id
            ORDER BY a.timestamp DESC
            LIMIT ?
            "#,
        )
        .bind(limit_value)
        .fetch_all(db.pool())
        .await
        .map_err(|e| format!("Error al obtener log de auditoría: {}", e))?
    };

    let mut result = Vec::new();
    for row in logs {
        let json = serde_json::json!({
            "id": row.try_get::<i64, _>("id").ok(),
            "user_id": row.try_get::<i64, _>("user_id").ok(),
            "username": row.try_get::<Option<String>, _>("username").ok().flatten(),
            "action": row.try_get::<String, _>("action").ok(),
            "table_name": row.try_get::<String, _>("table_name").ok(),
            "record_id": row.try_get::<i64, _>("record_id").ok(),
            "old_value": row.try_get::<Option<String>, _>("old_value").ok().flatten(),
            "new_value": row.try_get::<Option<String>, _>("new_value").ok().flatten(),
            "timestamp": row.try_get::<String, _>("timestamp").ok(),
            "base_datos_id": row.try_get::<Option<i64>, _>("base_datos_id").ok().flatten(),
        });
        result.push(json);
    }

    Ok(result)
}

/// Comando para cambiar contraseña de usuario
#[tauri::command]
pub async fn change_password(
    user_id: i64,
    old_password: String,
    new_password: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    // Verificar contraseña actual
    let current_hash: String = sqlx::query_scalar("SELECT password_hash FROM usuarios WHERE id = ?")
        .bind(user_id)
        .fetch_one(db.pool())
        .await
        .map_err(|e| format!("Error al obtener usuario: {}", e))?;

    if !verify_password(&old_password, &current_hash)? {
        return Err("Contraseña actual incorrecta".to_string());
    }

    // Hashear nueva contraseña
    let (new_hash, new_salt) = hash_password(&new_password)?;

    // Actualizar contraseña
    sqlx::query("UPDATE usuarios SET password_hash = ?, salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&new_hash)
        .bind(&new_salt)
        .bind(user_id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al actualizar contraseña: {}", e))?;

    // Registrar auditoría
    db.log_audit(user_id, "UPDATE", "usuarios", user_id, Some("password"), Some("***"), None)
        .await
        .map_err(|e| format!("Error al registrar auditoría: {}", e))?;

    Ok("Contraseña actualizada exitosamente".to_string())
}

/// Comando para que un administrador cambie la contraseña de otro usuario
#[tauri::command]
pub async fn admin_change_password(
    admin_id: i64,
    target_user_id: i64,
    new_password: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let (new_hash, new_salt) = hash_password(&new_password)?;

    sqlx::query("UPDATE usuarios SET password_hash = ?, salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&new_hash)
        .bind(&new_salt)
        .bind(target_user_id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al actualizar contraseña: {}", e))?;

    db.log_audit(admin_id, "UPDATE", "usuarios", target_user_id, Some("password"), Some("*** (cambio por administrador)"), None)
        .await
        .map_err(|e| format!("Error al registrar auditoría: {}", e))?;

    Ok("Contraseña actualizada exitosamente por el administrador".to_string())
}

/// Comando para cambiar nombre de usuario
#[tauri::command]
pub async fn change_username(
    user_id: i64,
    new_username: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    // Obtener nombre actual
    let old_username: String = sqlx::query_scalar("SELECT username FROM usuarios WHERE id = ?")
        .bind(user_id)
        .fetch_one(db.pool())
        .await
        .map_err(|e| format!("Error al obtener usuario: {}", e))?;

    // Verificar que el nuevo nombre no exista
    let exists: bool = sqlx::query_scalar("SELECT COUNT(*) > 0 FROM usuarios WHERE username = ? AND id != ?")
        .bind(&new_username)
        .bind(user_id)
        .fetch_one(db.pool())
        .await
        .map_err(|e| format!("Error al verificar username: {}", e))?;

    if exists {
        return Err("El nombre de usuario ya está en uso".to_string());
    }

    // Guardar en historial
    sqlx::query(
        "INSERT INTO username_history (user_id, old_username, new_username) VALUES (?, ?, ?)"
    )
    .bind(user_id)
    .bind(&old_username)
    .bind(&new_username)
    .execute(db.pool())
    .await
    .map_err(|e| format!("Error al guardar historial: {}", e))?;

    // Actualizar username
    sqlx::query("UPDATE usuarios SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&new_username)
        .bind(user_id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al actualizar username: {}", e))?;

    // Registrar auditoría
    db.log_audit(user_id, "UPDATE", "usuarios", user_id, Some(&old_username), Some(&new_username), None)
        .await
        .map_err(|e| format!("Error al registrar auditoría: {}", e))?;

    Ok("Nombre de usuario actualizado exitosamente".to_string())
}

/// Comando para obtener historial de cambios de nombre de usuario
#[tauri::command]
pub async fn get_username_history(
    user_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let history = sqlx::query(
        r#"
        SELECT old_username, new_username, changed_at
        FROM username_history
        WHERE user_id = ?
        ORDER BY changed_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(db.pool())
    .await
    .map_err(|e| format!("Error al obtener historial: {}", e))?;

    let mut result = Vec::new();
    for row in history {
        let json = serde_json::json!({
            "old_username": row.try_get::<String, _>("old_username").ok(),
            "new_username": row.try_get::<String, _>("new_username").ok(),
            "changed_at": row.try_get::<String, _>("changed_at").ok(),
        });
        result.push(json);
    }

    Ok(result)
}

/// Comando para obtener detalles completos de un activo incluyendo el creador
#[tauri::command]
pub async fn get_activo_detalles(
    activo_id: i64,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let activo = sqlx::query(
        r#"
        SELECT a.*, u.username as created_by_username, b.nombre as base_datos_nombre
        FROM activos a
        LEFT JOIN usuarios u ON a.created_by = u.id
        LEFT JOIN bases_datos b ON a.base_datos_id = b.id
        WHERE a.id = ?
        "#,
    )
    .bind(activo_id)
    .fetch_optional(db.pool())
    .await
    .map_err(|e| format!("Error al obtener activo: {}", e))?;

    if let Some(row) = activo {
        let json = serde_json::json!({
            "id": row.try_get::<i64, _>("id").ok(),
            "codigo": row.try_get::<String, _>("codigo").ok(),
            "nombre": row.try_get::<String, _>("nombre").ok(),
            "descripcion": row.try_get::<Option<String>, _>("descripcion").ok().flatten(),
            "categoria": row.try_get::<String, _>("categoria").ok(),
            "ubicacion": row.try_get::<Option<String>, _>("ubicacion").ok().flatten(),
            "responsable_id": row.try_get::<Option<i64>, _>("responsable_id").ok().flatten(),
            "estado": row.try_get::<String, _>("estado").ok(),
            "valor_adquisicion": row.try_get::<Option<f64>, _>("valor_adquisicion").ok().flatten(),
            "fecha_adquisicion": row.try_get::<Option<String>, _>("fecha_adquisicion").ok().flatten(),
            "fecha_vencimiento": row.try_get::<Option<String>, _>("fecha_vencimiento").ok().flatten(),
            "imagen_base64": row.try_get::<Option<String>, _>("imagen_base64").ok().flatten(),
            "created_by": row.try_get::<Option<i64>, _>("created_by").ok().flatten(),
            "created_by_username": row.try_get::<Option<String>, _>("created_by_username").ok().flatten(),
            "created_at": row.try_get::<String, _>("created_at").ok(),
            "base_datos_id": row.try_get::<Option<i64>, _>("base_datos_id").ok().flatten(),
            "base_datos_nombre": row.try_get::<Option<String>, _>("base_datos_nombre").ok().flatten(),
        });
        Ok(json)
    } else {
        Err("Activo no encontrado".to_string())
    }
}

/// Comando para registrar que un usuario vio un activo
#[tauri::command]
pub async fn register_activo_vista(
    activo_id: i64,
    user_id: i64,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    sqlx::query(
        r#"
        INSERT INTO activo_vistas (activo_id, usuario_id)
        VALUES (?, ?)
        "#,
    )
    .bind(activo_id)
    .bind(user_id)
    .execute(db.pool())
    .await
    .map_err(|e| format!("Error al registrar vista: {}", e))?;

    Ok("Vista registrada".to_string())
}

/// Comando para obtener el historial de vistas de un activo (últimas 10)
#[tauri::command]
pub async fn get_activo_vistas(
    activo_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let vistas = sqlx::query(
        r#"
        SELECT v.viewed_at, u.username, u.id as user_id
        FROM activo_vistas v
        INNER JOIN usuarios u ON v.usuario_id = u.id
        WHERE v.activo_id = ?
        ORDER BY v.viewed_at DESC
        LIMIT 10
        "#,
    )
    .bind(activo_id)
    .fetch_all(db.pool())
    .await
    .map_err(|e| format!("Error al obtener vistas: {}", e))?;

    let mut result = Vec::new();
    for row in vistas {
        let json = serde_json::json!({
            "user_id": row.try_get::<i64, _>("user_id").ok(),
            "username": row.try_get::<String, _>("username").ok(),
            "viewed_at": row.try_get::<String, _>("viewed_at").ok(),
        });
        result.push(json);
    }

    Ok(result)
}

/// Comando para actualizar solo la fecha de vencimiento de un activo
#[tauri::command]
pub async fn update_fecha_vencimiento(
    activo_id: i64,
    fecha_vencimiento: Option<String>,
    user_id: i64,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    sqlx::query(
        "UPDATE activos SET fecha_vencimiento = ? WHERE id = ?"
    )
    .bind(&fecha_vencimiento)
    .bind(activo_id)
    .execute(db.pool())
    .await
    .map_err(|e| format!("Error al actualizar fecha de vencimiento: {}", e))?;

    // Obtener base_datos_id para auditoría
    let bd_id: Option<i64> = sqlx::query_scalar("SELECT base_datos_id FROM activos WHERE id = ?")
        .bind(activo_id)
        .fetch_optional(db.pool())
        .await
        .map_err(|e| format!("Error al obtener base_datos_id: {}", e))?
        .flatten();

    // Registrar auditoría
    db.log_audit(user_id, "UPDATE", "activos", activo_id, None, Some("Actualizada fecha de vencimiento"), bd_id)
        .await
        .map_err(|e| format!("Error al registrar auditoría: {}", e))?;

    Ok("Fecha de vencimiento actualizada".to_string())
}

/// Comando para actualizar la zona horaria de un usuario
#[tauri::command]
pub async fn update_timezone(
    user_id: i64,
    timezone: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    // Actualizar timezone
    sqlx::query("UPDATE usuarios SET timezone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&timezone)
        .bind(user_id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al actualizar zona horaria: {}", e))?;

    // Registrar auditoría
    db.log_audit(user_id, "UPDATE", "usuarios", user_id, None, Some(&format!("Zona horaria actualizada a: {}", timezone)), None)
        .await
        .map_err(|e| format!("Error al registrar auditoría: {}", e))?;

    Ok("Zona horaria actualizada exitosamente".to_string())
}

// ==================== COMANDOS DE CATEGORÍAS ====================

/// Comando para obtener todas las categorías
#[tauri::command]
pub async fn get_categorias(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let categorias = sqlx::query(
        "SELECT id, nombre, descripcion, color, created_at FROM categorias ORDER BY nombre"
    )
    .fetch_all(db.pool())
    .await
    .map_err(|e| format!("Error al obtener categorías: {}", e))?;

    let mut result = Vec::new();
    for row in categorias {
        let json = serde_json::json!({
            "id": row.try_get::<i64, _>("id").ok(),
            "nombre": row.try_get::<String, _>("nombre").ok(),
            "descripcion": row.try_get::<Option<String>, _>("descripcion").ok().flatten(),
            "color": row.try_get::<Option<String>, _>("color").ok().flatten(),
            "created_at": row.try_get::<Option<String>, _>("created_at").ok().flatten(),
        });
        result.push(json);
    }

    Ok(result)
}

/// Estructura para crear categoría
#[derive(Debug, Deserialize)]
pub struct CategoriaInput {
    pub nombre: String,
    pub descripcion: Option<String>,
    pub color: Option<String>,
}

/// Comando para crear una categoría personalizada
#[tauri::command]
pub async fn create_categoria(
    categoria: CategoriaInput,
    user_id: i64,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let result = sqlx::query(
        "INSERT INTO categorias (nombre, descripcion, color) VALUES (?, ?, ?)"
    )
    .bind(&categoria.nombre)
    .bind(&categoria.descripcion)
    .bind(&categoria.color.unwrap_or_else(|| "#667eea".to_string()))
    .execute(db.pool())
    .await
    .map_err(|e| format!("Error al crear categoría: {}", e))?;

    let categoria_id = result.last_insert_rowid();

    // Registrar auditoría
    db.log_audit(user_id, "CREATE", "categorias", categoria_id, None, Some(&format!("Creada categoría: {}", categoria.nombre)), None)
        .await
        .map_err(|e| format!("Error al registrar auditoría: {}", e))?;

    Ok(categoria_id)
}

/// Comando para eliminar una categoría
#[tauri::command]
pub async fn delete_categoria(
    id: i64,
    user_id: i64,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    // Obtener nombre para auditoría
    let nombre: Option<String> = sqlx::query_scalar("SELECT nombre FROM categorias WHERE id = ?")
        .bind(id)
        .fetch_optional(db.pool())
        .await
        .map_err(|e| format!("Error al obtener categoría: {}", e))?;

    sqlx::query("DELETE FROM categorias WHERE id = ?")
        .bind(id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al eliminar categoría: {}", e))?;

    if let Some(cat_nombre) = nombre {
        db.log_audit(user_id, "DELETE", "categorias", id, Some(&cat_nombre), None, None)
            .await
            .map_err(|e| format!("Error al registrar auditoría: {}", e))?;
    }

    Ok("Categoría eliminada exitosamente".to_string())
}

// ==================== COMANDOS DE KEYWORDS ====================

/// Comando para obtener todas las keywords
#[tauri::command]
pub async fn get_keywords(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let keywords = sqlx::query(
        r#"
        SELECT id, palabra, palabra_normalizada, tipo, categoria_asociada, 
               idioma, es_sinonimo_de, activo, created_at 
        FROM keywords 
        WHERE activo = 1
        ORDER BY palabra
        "#
    )
    .fetch_all(db.pool())
    .await
    .map_err(|e| format!("Error al obtener keywords: {}", e))?;

    let mut result = Vec::new();
    for row in keywords {
        let json = serde_json::json!({
            "id": row.try_get::<i64, _>("id").ok(),
            "palabra": row.try_get::<String, _>("palabra").ok(),
            "palabra_normalizada": row.try_get::<String, _>("palabra_normalizada").ok(),
            "tipo": row.try_get::<String, _>("tipo").ok(),
            "categoria_asociada": row.try_get::<Option<String>, _>("categoria_asociada").ok().flatten(),
            "idioma": row.try_get::<Option<String>, _>("idioma").ok().flatten(),
            "es_sinonimo_de": row.try_get::<Option<String>, _>("es_sinonimo_de").ok().flatten(),
            "activo": row.try_get::<bool, _>("activo").ok(),
            "created_at": row.try_get::<Option<String>, _>("created_at").ok().flatten(),
        });
        result.push(json);
    }

    Ok(result)
}

/// Estructura para crear keyword
#[derive(Debug, Deserialize)]
pub struct KeywordInput {
    pub palabra: String,
    pub tipo: String,
    pub categoria_asociada: Option<String>,
    pub idioma: Option<String>,
    pub es_sinonimo_de: Option<String>,
}

/// Comando para crear una keyword
#[tauri::command]
pub async fn create_keyword(
    keyword: KeywordInput,
    user_id: i64,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    // Normalizar: quitar acentos y convertir a minúsculas
    let palabra_normalizada = normalize_keyword(&keyword.palabra);

    let result = sqlx::query(
        r#"
        INSERT INTO keywords (palabra, palabra_normalizada, tipo, categoria_asociada, idioma, es_sinonimo_de) 
        VALUES (?, ?, ?, ?, ?, ?)
        "#
    )
    .bind(&keyword.palabra)
    .bind(&palabra_normalizada)
    .bind(&keyword.tipo)
    .bind(&keyword.categoria_asociada)
    .bind(&keyword.idioma.unwrap_or_else(|| "es".to_string()))
    .bind(&keyword.es_sinonimo_de)
    .execute(db.pool())
    .await
    .map_err(|e| format!("Error al crear keyword: {}", e))?;

    let keyword_id = result.last_insert_rowid();

    db.log_audit(user_id, "CREATE", "keywords", keyword_id, None, Some(&format!("Creada keyword: {}", keyword.palabra)), None)
        .await
        .map_err(|e| format!("Error al registrar auditoría: {}", e))?;

    Ok(keyword_id)
}

/// Comando para eliminar una keyword
#[tauri::command]
pub async fn delete_keyword(
    id: i64,
    user_id: i64,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let palabra: Option<String> = sqlx::query_scalar("SELECT palabra FROM keywords WHERE id = ?")
        .bind(id)
        .fetch_optional(db.pool())
        .await
        .map_err(|e| format!("Error al obtener keyword: {}", e))?;

    // Soft delete - marcar como inactivo
    sqlx::query("UPDATE keywords SET activo = 0 WHERE id = ?")
        .bind(id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al eliminar keyword: {}", e))?;

    if let Some(kw) = palabra {
        db.log_audit(user_id, "DELETE", "keywords", id, Some(&kw), None, None)
            .await
            .map_err(|e| format!("Error al registrar auditoría: {}", e))?;
    }

    Ok("Keyword eliminada exitosamente".to_string())
}

// ==================== COMANDOS DE BASES DE DATOS ====================

/// Estructura para crear/actualizar una base de datos
#[derive(Debug, Deserialize)]
pub struct BaseDatosInput {
    pub nombre: String,
    pub descripcion: Option<String>,
}

/// Comando para obtener todas las bases de datos
#[tauri::command]
pub async fn get_bases_datos(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let rows = sqlx::query(
        r#"
        SELECT b.id, b.nombre, b.descripcion, b.created_at,
               (SELECT COUNT(*) FROM activos a WHERE a.base_datos_id = b.id) as total_activos
        FROM bases_datos b
        ORDER BY b.nombre
        "#
    )
    .fetch_all(db.pool())
    .await
    .map_err(|e| format!("Error al obtener bases de datos: {}", e))?;

    let mut result = Vec::new();
    for row in rows {
        let json = serde_json::json!({
            "id": row.try_get::<i64, _>("id").ok(),
            "nombre": row.try_get::<String, _>("nombre").ok(),
            "descripcion": row.try_get::<Option<String>, _>("descripcion").ok().flatten(),
            "created_at": row.try_get::<Option<String>, _>("created_at").ok().flatten(),
            "total_activos": row.try_get::<i64, _>("total_activos").ok().unwrap_or(0),
        });
        result.push(json);
    }

    Ok(result)
}

/// Comando para crear una base de datos
#[tauri::command]
pub async fn create_base_datos(
    base_datos: BaseDatosInput,
    user_id: i64,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let exists: bool = sqlx::query_scalar("SELECT COUNT(*) > 0 FROM bases_datos WHERE nombre = ?")
        .bind(&base_datos.nombre)
        .fetch_one(db.pool())
        .await
        .map_err(|e| format!("Error al verificar base de datos: {}", e))?;

    if exists {
        return Err("Ya existe una base de datos con ese nombre".to_string());
    }

    let result = sqlx::query(
        "INSERT INTO bases_datos (nombre, descripcion) VALUES (?, ?)"
    )
    .bind(&base_datos.nombre)
    .bind(&base_datos.descripcion)
    .execute(db.pool())
    .await
    .map_err(|e| format!("Error al crear base de datos: {}", e))?;

    let bd_id = result.last_insert_rowid();

    db.log_audit(user_id, "CREATE", "bases_datos", bd_id, None, Some(&format!("Creada base de datos: {}", base_datos.nombre)), None)
        .await
        .map_err(|e| format!("Error al registrar auditoría: {}", e))?;

    Ok(bd_id)
}

/// Comando para actualizar una base de datos
#[tauri::command]
pub async fn update_base_datos(
    id: i64,
    base_datos: BaseDatosInput,
    user_id: i64,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let old_nombre: Option<String> = sqlx::query_scalar("SELECT nombre FROM bases_datos WHERE id = ?")
        .bind(id)
        .fetch_optional(db.pool())
        .await
        .map_err(|e| format!("Error al obtener base de datos: {}", e))?
        .and_then(|v: String| if v.is_empty() { None } else { Some(v) });

    sqlx::query(
        "UPDATE bases_datos SET nombre = ?, descripcion = ? WHERE id = ?"
    )
    .bind(&base_datos.nombre)
    .bind(&base_datos.descripcion)
    .bind(id)
    .execute(db.pool())
    .await
    .map_err(|e| format!("Error al actualizar base de datos: {}", e))?;

    db.log_audit(user_id, "UPDATE", "bases_datos", id, old_nombre.as_deref(), Some(&format!("Actualizada base de datos: {}", base_datos.nombre)), None)
        .await
        .map_err(|e| format!("Error al registrar auditoría: {}", e))?;

    Ok("Base de datos actualizada exitosamente".to_string())
}

/// Comando para eliminar una base de datos
#[tauri::command]
pub async fn delete_base_datos(
    id: i64,
    user_id: i64,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let activos_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM activos WHERE base_datos_id = ?")
        .bind(id)
        .fetch_one(db.pool())
        .await
        .map_err(|e| format!("Error al verificar activos: {}", e))?;

    if activos_count > 0 {
        return Err(format!("No se puede eliminar la base de datos porque tiene {} activos asociados. Reasigne o elimine los activos primero.", activos_count));
    }

    let nombre: Option<String> = sqlx::query_scalar("SELECT nombre FROM bases_datos WHERE id = ?")
        .bind(id)
        .fetch_optional(db.pool())
        .await
        .map_err(|e| format!("Error al obtener base de datos: {}", e))?;

    sqlx::query("DELETE FROM usuario_base_datos WHERE base_datos_id = ?")
        .bind(id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al eliminar asignaciones: {}", e))?;

    sqlx::query("DELETE FROM auditoria WHERE base_datos_id = ?")
        .bind(id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al eliminar auditoría: {}", e))?;

    sqlx::query("DELETE FROM bases_datos WHERE id = ?")
        .bind(id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al eliminar base de datos: {}", e))?;

    if let Some(nom) = nombre {
        db.log_audit(user_id, "DELETE", "bases_datos", id, Some(&nom), None, None)
            .await
            .map_err(|e| format!("Error al registrar auditoría: {}", e))?;
    }

    Ok("Base de datos eliminada exitosamente".to_string())
}

/// Comando para obtener las bases de datos asignadas a un usuario
#[tauri::command]
pub async fn get_user_bases_datos(
    target_user_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    // Si el usuario es administrador, retornar todas las bases de datos
    let rol: String = sqlx::query_scalar("SELECT rol FROM usuarios WHERE id = ?")
        .bind(target_user_id)
        .fetch_optional(db.pool())
        .await
        .map_err(|e| format!("Error al obtener rol: {}", e))?
        .ok_or("Usuario no encontrado")?;

    let rows = if rol == "administrador" {
        sqlx::query(
            r#"
            SELECT b.id, b.nombre, b.descripcion
            FROM bases_datos b
            ORDER BY b.nombre
            "#
        )
        .fetch_all(db.pool())
        .await
        .map_err(|e| format!("Error al obtener bases de datos: {}", e))?
    } else {
        sqlx::query(
            r#"
            SELECT b.id, b.nombre, b.descripcion
            FROM bases_datos b
            INNER JOIN usuario_base_datos ub ON b.id = ub.base_datos_id
            WHERE ub.usuario_id = ?
            ORDER BY b.nombre
            "#
        )
        .bind(target_user_id)
        .fetch_all(db.pool())
        .await
        .map_err(|e| format!("Error al obtener bases de datos del usuario: {}", e))?
    };

    let mut result = Vec::new();
    for row in rows {
        let json = serde_json::json!({
            "id": row.try_get::<i64, _>("id").ok(),
            "nombre": row.try_get::<String, _>("nombre").ok(),
            "descripcion": row.try_get::<Option<String>, _>("descripcion").ok().flatten(),
        });
        result.push(json);
    }

    Ok(result)
}

/// Comando para asignar un usuario a una base de datos
#[tauri::command]
pub async fn assign_user_to_base_datos(
    target_user_id: i64,
    base_datos_id: i64,
    admin_id: i64,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let exists: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM usuario_base_datos WHERE usuario_id = ? AND base_datos_id = ?"
    )
    .bind(target_user_id)
    .bind(base_datos_id)
    .fetch_one(db.pool())
    .await
    .map_err(|e| format!("Error al verificar asignación: {}", e))?;

    if !exists {
        sqlx::query(
            "INSERT INTO usuario_base_datos (usuario_id, base_datos_id) VALUES (?, ?)"
        )
        .bind(target_user_id)
        .bind(base_datos_id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al asignar base de datos: {}", e))?;
    }

    db.log_audit(admin_id, "ASSIGN", "usuario_base_datos", target_user_id, None, Some(&format!("Asignada base_datos_id: {}", base_datos_id)), Some(base_datos_id))
        .await
        .map_err(|e| format!("Error al registrar auditoría: {}", e))?;

    Ok("Usuario asignado exitosamente".to_string())
}

/// Comando para desasignar un usuario de una base de datos
#[tauri::command]
pub async fn unassign_user_from_base_datos(
    target_user_id: i64,
    base_datos_id: i64,
    admin_id: i64,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    sqlx::query(
        "DELETE FROM usuario_base_datos WHERE usuario_id = ? AND base_datos_id = ?"
    )
    .bind(target_user_id)
    .bind(base_datos_id)
    .execute(db.pool())
    .await
    .map_err(|e| format!("Error al desasignar base de datos: {}", e))?;

    db.log_audit(admin_id, "UNASSIGN", "usuario_base_datos", target_user_id, None, Some(&format!("Desasignada base_datos_id: {}", base_datos_id)), Some(base_datos_id))
        .await
        .map_err(|e| format!("Error al registrar auditoría: {}", e))?;

    Ok("Usuario desasignado exitosamente".to_string())
}

/// Comando para obtener las bases de datos disponibles (a las que un usuario NO está asignado)
#[tauri::command]
pub async fn get_available_bases_datos(
    target_user_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let rows = sqlx::query(
        r#"
        SELECT b.id, b.nombre, b.descripcion
        FROM bases_datos b
        WHERE b.id NOT IN (
            SELECT base_datos_id FROM usuario_base_datos WHERE usuario_id = ?
        )
        ORDER BY b.nombre
        "#
    )
    .bind(target_user_id)
    .fetch_all(db.pool())
    .await
    .map_err(|e| format!("Error al obtener bases de datos disponibles: {}", e))?;

    let mut result = Vec::new();
    for row in rows {
        let json = serde_json::json!({
            "id": row.try_get::<i64, _>("id").ok(),
            "nombre": row.try_get::<String, _>("nombre").ok(),
            "descripcion": row.try_get::<Option<String>, _>("descripcion").ok().flatten(),
        });
        result.push(json);
    }

    Ok(result)
}

/// Comando para verificar la contraseña de un administrador
#[tauri::command]
pub async fn verify_admin_password(
    admin_id: i64,
    password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let admin_rol: String = sqlx::query_scalar("SELECT rol FROM usuarios WHERE id = ?")
        .bind(admin_id)
        .fetch_optional(db.pool())
        .await
        .map_err(|e| format!("Error al verificar admin: {}", e))?
        .ok_or("Usuario no encontrado")?;

    if admin_rol != "administrador" {
        return Err("Solo los administradores pueden realizar esta acción".to_string());
    }

    let stored_hash: String = sqlx::query_scalar("SELECT password_hash FROM usuarios WHERE id = ?")
        .bind(admin_id)
        .fetch_optional(db.pool())
        .await
        .map_err(|e| format!("Error al obtener hash: {}", e))?
        .ok_or("Usuario no encontrado")?;

    if !verify_password(&password, &stored_hash).map_err(|e| format!("Error al verificar: {}", e))? {
        return Err("Contraseña incorrecta".to_string());
    }

    Ok(())
}

/// Comando para exportar una base de datos como JSON cifrado en ZIP
#[tauri::command]
pub async fn export_base_datos(
    admin_id: i64,
    password: String,
    base_datos_id: i64,
    save_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    // Verificar que el usuario es administrador
    let admin_rol: String = sqlx::query_scalar("SELECT rol FROM usuarios WHERE id = ?")
        .bind(admin_id)
        .fetch_optional(db.pool())
        .await
        .map_err(|e| format!("Error al verificar admin: {}", e))?
        .ok_or("Usuario no encontrado")?;

    if admin_rol != "administrador" {
        return Err("Solo los administradores pueden exportar bases de datos".to_string());
    }

    // Verificar contraseña
    let stored_hash: String = sqlx::query_scalar("SELECT password_hash FROM usuarios WHERE id = ?")
        .bind(admin_id)
        .fetch_optional(db.pool())
        .await
        .map_err(|e| format!("Error al obtener hash: {}", e))?
        .ok_or("Usuario no encontrado")?;

    if !verify_password(&password, &stored_hash).map_err(|e| format!("Error al verificar: {}", e))? {
        return Err("Contraseña incorrecta".to_string());
    }

    // Obtener info de la base de datos
    let base_info: (String, Option<String>) = sqlx::query_as(
        "SELECT nombre, descripcion FROM bases_datos WHERE id = ?"
    )
    .bind(base_datos_id)
    .fetch_optional(db.pool())
    .await
    .map_err(|e| format!("Error al obtener base de datos: {}", e))?
    .ok_or("Base de datos no encontrada")?;

    // Obtener activos de esta base
    let activos: Vec<serde_json::Value> = sqlx::query(
        r#"
        SELECT id, codigo, nombre, descripcion, categoria, ubicacion, estado,
               valor_adquisicion, fecha_adquisicion, fecha_vencimiento, palabras_clave,
               imagen_base64, created_at, created_by
        FROM activos WHERE base_datos_id = ?
        ORDER BY id
        "#
    )
    .bind(base_datos_id)
    .fetch_all(db.pool())
    .await
    .map_err(|e| format!("Error al obtener activos: {}", e))?
    .iter()
    .map(|row| {
        serde_json::json!({
            "id": row.try_get::<i64, _>("id").ok(),
            "codigo": row.try_get::<String, _>("codigo").ok(),
            "nombre": row.try_get::<String, _>("nombre").ok(),
            "descripcion": row.try_get::<Option<String>, _>("descripcion").ok().flatten(),
            "categoria": row.try_get::<String, _>("categoria").ok(),
            "ubicacion": row.try_get::<Option<String>, _>("ubicacion").ok().flatten(),
            "estado": row.try_get::<String, _>("estado").ok(),
            "valor_adquisicion": row.try_get::<Option<f64>, _>("valor_adquisicion").ok().flatten(),
            "fecha_adquisicion": row.try_get::<Option<String>, _>("fecha_adquisicion").ok().flatten(),
            "fecha_vencimiento": row.try_get::<Option<String>, _>("fecha_vencimiento").ok().flatten(),
            "palabras_clave": row.try_get::<Option<String>, _>("palabras_clave").ok().flatten(),
            "imagen_base64": row.try_get::<Option<String>, _>("imagen_base64").ok().flatten(),
            "created_at": row.try_get::<Option<String>, _>("created_at").ok().flatten(),
            "created_by": row.try_get::<Option<i64>, _>("created_by").ok().flatten(),
        })
    })
    .collect();

    // Obtener auditoría de esta base
    let auditoria: Vec<serde_json::Value> = sqlx::query(
        r#"
        SELECT id, usuario_id, accion, tabla, registro_id, datos_anteriores, datos_nuevos, timestamp
        FROM auditoria WHERE base_datos_id = ? OR (tabla = 'activos' AND registro_id IN (
            SELECT id FROM activos WHERE base_datos_id = ?
        ))
        ORDER BY id
        "#
    )
    .bind(base_datos_id)
    .bind(base_datos_id)
    .fetch_all(db.pool())
    .await
    .map_err(|e| format!("Error al obtener auditoría: {}", e))?
    .iter()
    .map(|row| {
        serde_json::json!({
            "id": row.try_get::<i64, _>("id").ok(),
            "usuario_id": row.try_get::<i64, _>("usuario_id").ok(),
            "accion": row.try_get::<String, _>("accion").ok(),
            "tabla": row.try_get::<String, _>("tabla").ok(),
            "registro_id": row.try_get::<Option<i64>, _>("registro_id").ok().flatten(),
            "datos_anteriores": row.try_get::<Option<String>, _>("datos_anteriores").ok().flatten(),
            "datos_nuevos": row.try_get::<Option<String>, _>("datos_nuevos").ok().flatten(),
            "timestamp": row.try_get::<Option<String>, _>("timestamp").ok().flatten(),
        })
    })
    .collect();

    // Obtener usuarios asignados a esta base
    let usuarios_asignados: Vec<i64> = sqlx::query_scalar(
        "SELECT usuario_id FROM usuario_base_datos WHERE base_datos_id = ?"
    )
    .bind(base_datos_id)
    .fetch_all(db.pool())
    .await
    .map_err(|e| format!("Error al obtener usuarios asignados: {}", e))?;

    // Construir JSON completo
    let export_data = serde_json::json!({
        "version": "1.0",
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "exported_by": admin_id,
        "base_datos": {
            "id": base_datos_id,
            "nombre": base_info.0,
            "descripcion": base_info.1,
        },
        "activos": activos,
        "auditoria": auditoria,
        "usuarios_asignados": usuarios_asignados,
    });

    let json_str = serde_json::to_string_pretty(&export_data)
        .map_err(|e| format!("Error al serializar JSON: {}", e))?;

    // Generar contraseña aleatoria de 30 caracteres
    let export_password: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(30)
        .map(char::from)
        .collect();

    // Crear archivo 7z cifrado con AES-256
    // Escribimos JSON a un archivo temporal y lo comprimimos
    let temp_dir = std::env::temp_dir().join("gestor_export");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Error al crear directorio temporal: {}", e))?;
    let temp_file = temp_dir.join("datos.json");
    std::fs::write(&temp_file, &json_str)
        .map_err(|e| format!("Error al escribir archivo temporal: {}", e))?;

    sevenz_rust::compress_to_path_encrypted(
        &temp_file,
        &save_path,
        export_password.as_str().into(),
    )
    .map_err(|e| format!("Error al crear archivo 7z cifrado: {}", e))?;

    // Limpiar archivos temporales
    std::fs::remove_file(&temp_file).ok();
    std::fs::remove_dir(&temp_dir).ok();

    Ok(export_password)
}

/// Comando para importar una base de datos desde un archivo JSON cifrado
#[tauri::command]
pub async fn import_base_datos(
    admin_id: i64,
    password: String,
    file_path: String,
    import_password: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    // Verificar que el usuario es administrador
    let admin_rol: String = sqlx::query_scalar("SELECT rol FROM usuarios WHERE id = ?")
        .bind(admin_id)
        .fetch_optional(db.pool())
        .await
        .map_err(|e| format!("Error al verificar admin: {}", e))?
        .ok_or("Usuario no encontrado")?;

    if admin_rol != "administrador" {
        return Err("Solo los administradores pueden importar bases de datos".to_string());
    }

    // Verificar contraseña del admin
    let stored_hash: String = sqlx::query_scalar("SELECT password_hash FROM usuarios WHERE id = ?")
        .bind(admin_id)
        .fetch_optional(db.pool())
        .await
        .map_err(|e| format!("Error al obtener hash: {}", e))?
        .ok_or("Usuario no encontrado")?;

    if !verify_password(&password, &stored_hash).map_err(|e| format!("Error al verificar: {}", e))? {
        return Err("Contraseña incorrecta".to_string());
    }

    // Leer y desencriptar el archivo 7z
    let file = std::fs::File::open(&file_path)
        .map_err(|e| format!("Error al abrir archivo: {}", e))?;
    let file_len = file.metadata()
        .map_err(|e| format!("Error al obtener tamaño: {}", e))?
        .len();
    let reader = BufReader::new(file);
    let mut archive = SevenZReader::new(reader, file_len, import_password.as_str().into())
        .map_err(|e| format!("Error al leer archivo 7z: {}", e))?;

    // Buscar el archivo datos.json dentro del 7z
    let mut json_str = String::new();
    let mut found = false;

    let result = archive.for_each_entries(|entry, entry_reader| {
        if entry.name == "datos.json" {
            let mut buf = String::new();
            entry_reader.read_to_string(&mut buf)
                .map_err(|e| sevenz_rust::Error::io_msg(e, "Error al leer datos.json"))?;
            json_str = buf;
            found = true;
            Ok(false) // stop iterating
        } else {
            Ok(true) // continue
        }
    });
    if let Err(e) = result {
        let err_msg = format!("{}", e);
        if err_msg.contains("Corrupted input data") || err_msg.contains("LZMA") {
            return Err("Contraseña de exportación incorrecta. El archivo no pudo ser descifrado. Verifique la contraseña e intente de nuevo.".to_string());
        }
        return Err(format!("Error al procesar entradas: {}", e));
    }

    if !found {
        return Err("No se encontró datos.json en el archivo o contraseña incorrecta".to_string());
    }

    // Parsear JSON
    let data: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Error al parsear JSON: {}", e))?;

    let base_datos = data.get("base_datos")
        .ok_or("JSON inválido: falta base_datos")?;
    let base_nombre = base_datos.get("nombre")
        .and_then(|v| v.as_str())
        .ok_or("JSON inválido: falta nombre")?;

    // Verificar que no exista ya una base con ese nombre
    let exists: bool = sqlx::query_scalar("SELECT COUNT(*) > 0 FROM bases_datos WHERE nombre = ?")
        .bind(base_nombre)
        .fetch_one(db.pool())
        .await
        .map_err(|e| format!("Error al verificar base existente: {}", e))?;

    if exists {
        return Err(format!("Ya existe una base de datos llamada '{}'. Renombre el archivo o cambie el nombre en el JSON.", base_nombre));
    }

    // Crear la base de datos
    let base_descripcion = base_datos.get("descripcion").and_then(|v| v.as_str());
    sqlx::query("INSERT INTO bases_datos (nombre, descripcion) VALUES (?, ?)")
        .bind(base_nombre)
        .bind(base_descripcion)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al crear base de datos: {}", e))?;

    let new_base_id: i64 = sqlx::query_scalar("SELECT id FROM bases_datos WHERE nombre = ?")
        .bind(base_nombre)
        .fetch_one(db.pool())
        .await
        .map_err(|e| format!("Error al obtener nueva base: {}", e))?;

    // Importar activos
    let base_nombre_ref = base_nombre; // capturar para usar en descripción
    if let Some(activos) = data.get("activos").and_then(|v| v.as_array()) {
        for activo in activos {
            let codigo = activo.get("codigo").and_then(|v| v.as_str()).unwrap_or("SIN-CODIGO");
            let nombre = activo.get("nombre").and_then(|v| v.as_str()).unwrap_or("Sin nombre");
            let descripcion_original = activo.get("descripcion").and_then(|v| v.as_str()).unwrap_or("");
            let descripcion = if descripcion_original.is_empty() {
                Some(format!("[Base original: {}]", base_nombre_ref))
            } else {
                Some(format!("[Base original: {}] {}", base_nombre_ref, descripcion_original))
            };
            let categoria = activo.get("categoria").and_then(|v| v.as_str()).unwrap_or("General");
            let ubicacion = activo.get("ubicacion").and_then(|v| v.as_str());
            let estado = activo.get("estado").and_then(|v| v.as_str()).unwrap_or("operativo");
            let valor = activo.get("valor_adquisicion").and_then(|v| v.as_f64());
            let fecha_adq = activo.get("fecha_adquisicion").and_then(|v| v.as_str());
            let fecha_venc = activo.get("fecha_vencimiento").and_then(|v| v.as_str());
            let palabras = activo.get("palabras_clave").and_then(|v| v.as_str());
            let imagen = activo.get("imagen_base64").and_then(|v| v.as_str());
            let created_by = activo.get("created_by").and_then(|v| v.as_i64());

            sqlx::query(
                r#"
                INSERT INTO activos (codigo, nombre, descripcion, categoria, ubicacion, estado,
                    valor_adquisicion, fecha_adquisicion, fecha_vencimiento, palabras_clave,
                    imagen_base64, base_datos_id, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                "#
            )
            .bind(codigo)
            .bind(nombre)
            .bind(descripcion)
            .bind(categoria)
            .bind(ubicacion)
            .bind(estado)
            .bind(valor)
            .bind(fecha_adq)
            .bind(fecha_venc)
            .bind(palabras)
            .bind(imagen)
            .bind(new_base_id)
            .bind(created_by)
            .execute(db.pool())
            .await
            .map_err(|e| format!("Error al importar activo '{}': {}", nombre, e))?;
        }
    }

    // Asignar usuarios que estaban asignados originalmente (si existen)
    if let Some(usuarios) = data.get("usuarios_asignados").and_then(|v| v.as_array()) {
        for uid in usuarios {
            if let Some(uid_val) = uid.as_i64() {
                let _ = sqlx::query("INSERT OR IGNORE INTO usuario_base_datos (usuario_id, base_datos_id) VALUES (?, ?)")
                    .bind(uid_val)
                    .bind(new_base_id)
                    .execute(db.pool())
                    .await;
            }
        }
    }

    // Registrar auditoría
    let _ = db.log_audit(
        admin_id,
        "IMPORT",
        "bases_datos",
        new_base_id,
        None,
        Some(&format!("Base de datos importada: {} ({} activos)", base_nombre, data.get("activos").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0))),
        None,
    ).await;

    Ok(format!("Base de datos '{}' importada exitosamente con {} activos",
        base_nombre,
        data.get("activos").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0)))
}

#[tauri::command]
pub async fn export_base_datos_excel(
    admin_id: i64,
    password: String,
    base_datos_id: i64,
    save_path: String,
    selected_fields: Vec<String>,
    include_audits: bool,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    // Verificar admin
    let user_rol: String = sqlx::query_scalar("SELECT rol FROM usuarios WHERE id = ?")
        .bind(admin_id)
        .fetch_optional(db.pool())
        .await
        .map_err(|e| format!("Error al verificar admin: {}", e))?
        .ok_or("Usuario no encontrado")?;
    if user_rol != "administrador" {
        return Err("Se requieren permisos de administrador".to_string());
    }
    let stored_hash: String = sqlx::query_scalar("SELECT password_hash FROM usuarios WHERE id = ?")
        .bind(admin_id)
        .fetch_optional(db.pool())
        .await
        .map_err(|e| format!("Error al obtener hash: {}", e))?
        .ok_or("Usuario no encontrado")?;
    verify_password(&password, &stored_hash).map_err(|_| "Contraseña incorrecta".to_string())?;

    // Obtener nombre de la base de datos
    let base_nombre: String = sqlx::query_scalar("SELECT nombre FROM bases_datos WHERE id = ?")
        .bind(base_datos_id)
        .fetch_optional(db.pool())
        .await
        .map_err(|e| format!("Error al obtener base de datos: {}", e))?
        .ok_or("Base de datos no encontrada".to_string())?;

    // Query de activos
    let activos = sqlx::query(
        "SELECT id, codigo, nombre, descripcion, categoria, ubicacion, estado, \
         valor_adquisicion, fecha_adquisicion, fecha_vencimiento, palabras_clave \
         FROM activos WHERE base_datos_id = ? ORDER BY nombre"
    )
    .bind(base_datos_id)
    .fetch_all(db.pool())
    .await
    .map_err(|e| format!("Error al obtener activos: {}", e))?;

    use rust_xlsxwriter::*;

    let mut workbook = Workbook::new();

    // --- Hoja 1: Activos ---
    let header_fmt = Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0x4A5D23));

    let sheet1 = workbook.add_worksheet();
    sheet1.set_name("Activos").map_err(|e| format!("Error naming sheet: {}", e))?;

    // Escribir headers según campos seleccionados
    let col_headers: Vec<(&str, &str)> = vec![
        ("codigo", "Código"),
        ("nombre", "Nombre"),
        ("descripcion", "Descripción"),
        ("categoria", "Categoría"),
        ("ubicacion", "Ubicación"),
        ("estado", "Estado"),
        ("valor_adquisicion", "Valor Adquisición"),
        ("fecha_adquisicion", "Fecha Adquisición"),
        ("fecha_vencimiento", "Fecha Vencimiento"),
        ("palabras_clave", "Palabras Clave"),
    ];

    let visible_headers: Vec<&str> = col_headers.iter()
        .filter(|(key, _)| selected_fields.contains(&key.to_string()))
        .map(|(_, label)| *label)
        .collect();

    for (col, header) in visible_headers.iter().enumerate() {
        sheet1.write_string_with_format(0, col as u16, *header, &header_fmt)
            .map_err(|e| format!("Error writing header: {}", e))?;
    }

    for (row, row_data) in activos.iter().enumerate() {
        let row_idx = (row + 1) as u32;
        let mut col = 0u16;

        if selected_fields.contains(&"codigo".to_string()) {
            let v: String = row_data.try_get("codigo").unwrap_or_default();
            sheet1.write_string(row_idx, col, &v).map_err(|e| format!("Error writing: {}", e))?;
            col += 1;
        }
        if selected_fields.contains(&"nombre".to_string()) {
            let v: String = row_data.try_get("nombre").unwrap_or_default();
            sheet1.write_string(row_idx, col, &v).map_err(|e| format!("Error writing: {}", e))?;
            col += 1;
        }
        if selected_fields.contains(&"descripcion".to_string()) {
            let v: Option<String> = row_data.try_get("descripcion").ok().flatten();
            sheet1.write_string(row_idx, col, &v.unwrap_or_default()).map_err(|e| format!("Error writing: {}", e))?;
            col += 1;
        }
        if selected_fields.contains(&"categoria".to_string()) {
            let v: String = row_data.try_get("categoria").unwrap_or_default();
            sheet1.write_string(row_idx, col, &v).map_err(|e| format!("Error writing: {}", e))?;
            col += 1;
        }
        if selected_fields.contains(&"ubicacion".to_string()) {
            let v: Option<String> = row_data.try_get("ubicacion").ok().flatten();
            sheet1.write_string(row_idx, col, &v.unwrap_or_default()).map_err(|e| format!("Error writing: {}", e))?;
            col += 1;
        }
        if selected_fields.contains(&"estado".to_string()) {
            let v: String = row_data.try_get("estado").unwrap_or_default();
            sheet1.write_string(row_idx, col, &v).map_err(|e| format!("Error writing: {}", e))?;
            col += 1;
        }
        if selected_fields.contains(&"valor_adquisicion".to_string()) {
            let v: Option<f64> = row_data.try_get("valor_adquisicion").ok().flatten();
            if let Some(val) = v {
                let num_fmt = Format::new().set_num_format("#,##0.00");
                sheet1.write_number_with_format(row_idx, col, val, &num_fmt)
                    .map_err(|e| format!("Error writing: {}", e))?;
            }
            col += 1;
        }
        if selected_fields.contains(&"fecha_adquisicion".to_string()) {
            let v: Option<String> = row_data.try_get("fecha_adquisicion").ok().flatten();
            sheet1.write_string(row_idx, col, &v.unwrap_or_default()).map_err(|e| format!("Error writing: {}", e))?;
            col += 1;
        }
        if selected_fields.contains(&"fecha_vencimiento".to_string()) {
            let v: Option<String> = row_data.try_get("fecha_vencimiento").ok().flatten();
            sheet1.write_string(row_idx, col, &v.unwrap_or_default()).map_err(|e| format!("Error writing: {}", e))?;
            col += 1;
        }
        if selected_fields.contains(&"palabras_clave".to_string()) {
            let v: Option<String> = row_data.try_get("palabras_clave").ok().flatten();
            sheet1.write_string(row_idx, col, &v.unwrap_or_default()).map_err(|e| format!("Error writing: {}", e))?;
        }
    }

    // --- Hoja 2: Auditoría (opcional) ---
    if include_audits {
        let audits = sqlx::query(
            "SELECT a.id, a.usuario_id as user_id, u.username as username, \
             a.accion as action, a.tabla as table_name, \
             a.registro_id as record_id, a.datos_anteriores as old_value, \
             a.datos_nuevos as new_value, a.timestamp \
             FROM auditoria a \
             LEFT JOIN usuarios u ON a.usuario_id = u.id \
             ORDER BY a.timestamp DESC"
        )
        .fetch_all(db.pool())
        .await
        .map_err(|e| format!("Error al obtener auditorías: {}", e))?;

        let sheet2 = workbook.add_worksheet();
        sheet2.set_name("Auditoría").map_err(|e| format!("Error naming sheet: {}", e))?;

        let audit_headers = ["ID", "Usuario", "Acción", "Tabla", "Registro ID", "Valor Anterior", "Valor Nuevo", "Fecha/Hora"];
        for (col, header) in audit_headers.iter().enumerate() {
            sheet2.write_string_with_format(0, col as u16, *header, &header_fmt)
                .map_err(|e| format!("Error writing audit header: {}", e))?;
        }

        for (row, audit) in audits.iter().enumerate() {
            let r = (row + 1) as u32;
            let id: i64 = audit.try_get("id").unwrap_or(0);
            sheet2.write_number(r, 0, id as f64).map_err(|e| format!("Error: {}", e))?;
            let username: Option<String> = audit.try_get("username").ok().flatten();
            sheet2.write_string(r, 1, &username.unwrap_or_default()).map_err(|e| format!("Error: {}", e))?;
            let action: String = audit.try_get("action").unwrap_or_default();
            sheet2.write_string(r, 2, &action).map_err(|e| format!("Error: {}", e))?;
            let table: String = audit.try_get("table_name").unwrap_or_default();
            sheet2.write_string(r, 3, &table).map_err(|e| format!("Error: {}", e))?;
            let record_id: i64 = audit.try_get("record_id").unwrap_or(0);
            sheet2.write_number(r, 4, record_id as f64).map_err(|e| format!("Error: {}", e))?;
            let old_val: Option<String> = audit.try_get("old_value").ok().flatten();
            sheet2.write_string(r, 5, &old_val.unwrap_or_default()).map_err(|e| format!("Error: {}", e))?;
            let new_val: Option<String> = audit.try_get("new_value").ok().flatten();
            sheet2.write_string(r, 6, &new_val.unwrap_or_default()).map_err(|e| format!("Error: {}", e))?;
            let ts: String = audit.try_get("timestamp").unwrap_or_default();
            sheet2.write_string(r, 7, &ts).map_err(|e| format!("Error: {}", e))?;
        }
    }

    // Guardar archivo
    workbook.save(&save_path).map_err(|e| format!("Error al guardar Excel: {}", e))?;

    // Registrar auditoría
    let accion_desc = if include_audits { format!("Exportación Excel de BD '{}' con activos y auditoría global", base_nombre) } else { format!("Exportación Excel de BD '{}' (solo activos)", base_nombre) };
    db.log_audit(admin_id, "EXPORT_EXCEL", "bases_datos", base_datos_id, Some(&accion_desc), None, Some(base_datos_id)).await
        .map_err(|e| format!("Error al registrar auditoría: {}", e))?;

    Ok(format!("Excel exportado exitosamente: {}", save_path))
}

/// Función auxiliar para normalizar keywords (quitar acentos, minúsculas)
fn normalize_keyword(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            _ => c,
        })
        .collect()
}

