use crate::crypto::{hash_password, verify_password};
use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::sync::Mutex;
use std::sync::Mutex as StdMutex;
use sqlx::Row;

/// Estado compartido de la aplicación
pub struct AppState {
    pub db: Mutex<Option<crate::db::Database>>,
    pub can_close_app: StdMutex<bool>,
    pub active_user_id: StdMutex<Option<i64>>,
    pub login_timestamp: StdMutex<Option<String>>,
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
}

/// Comando Tauri para crear un nuevo usuario
/// 
/// Este comando es invocado desde Angular mediante invoke()
#[tauri::command]
pub async fn create_user(
    username: String,
    password: String,
    rol: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Obtener conexión a la base de datos
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    // Verificar si el usuario ya existe
    let exists: bool = sqlx::query_scalar("SELECT COUNT(*) > 0 FROM usuarios WHERE username = ?")
        .bind(&username)
        .fetch_one(db.pool())
        .await
        .map_err(|e| format!("Error al verificar usuario: {}", e))?;

    if exists {
        return Err("El nombre de usuario ya está en uso. Por favor, intente con otro nombre de usuario.".to_string());
    }

    // Hashear contraseña
    let (password_hash, salt) = hash_password(&password)?;

    // Insertar usuario
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

    Ok(format!("Usuario {} creado exitosamente", username))
}

/// Comando Tauri para autenticar un usuario
#[tauri::command]
pub async fn login(
    request: LoginRequest,
    state: State<'_, AppState>,
) -> Result<LoginResponse, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    // Buscar usuario por username
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
        // Verificar contraseña
        if verify_password(&request.password, &password_hash)? {
            // Registrar auditoría de login exitoso
            db.log_audit(user_id, "LOGIN", "usuarios", user_id, None, None)
                .await
                .map_err(|e| format!("Error al registrar auditoría: {}", e))?;

            // Registrar sesión activa y prevenir cierre de app
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
            })
        } else {
            Ok(LoginResponse {
                success: false,
                message: "Contraseña incorrecta".to_string(),
                user_id: None,
                username: None,
                rol: None,
                timezone: None,
            })
        }
    } else {
        Ok(LoginResponse {
            success: false,
            message: "Usuario no encontrado".to_string(),
            user_id: None,
            username: None,
            rol: None,
            timezone: None,
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

    // Registrar auditoría de logout
    db.log_audit(user_id, "LOGOUT", "usuarios", user_id, None, Some(&logout_message))
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
                let _ = db.log_audit(user_id, "LOGOUT", "usuarios", user_id, None, Some(&logout_message)).await;
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

/// Comando Tauri para obtener la lista de activos
#[tauri::command]
pub async fn get_activos(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let activos = sqlx::query(
        r#"
        SELECT id, codigo, nombre, descripcion, categoria, ubicacion, 
               responsable_id, estado, valor_adquisicion, fecha_adquisicion, 
               fecha_vencimiento, imagen_base64, palabras_clave, created_by, created_at
        FROM activos
        ORDER BY codigo
        "#,
    )
    .fetch_all(db.pool())
    .await
    .map_err(|e| format!("Error al obtener activos: {}", e))?;

    // Convertir resultados a JSON
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
                            responsable_id, estado, valor_adquisicion, fecha_adquisicion, 
                            fecha_vencimiento, imagen_base64, palabras_clave, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    .bind(user_id)
    .execute(db.pool())
    .await
    .map_err(|e| format!("Error al crear activo: {}", e))?;

    let activo_id = result.last_insert_rowid();

    // Registrar auditoría
    db.log_audit(user_id, "CREATE", "activos", activo_id, None, Some(&format!("Creado activo: {}", activo.nombre)))
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

    // Obtener valores anteriores para auditoría
    let old_values = sqlx::query(
        "SELECT codigo, nombre, categoria, estado FROM activos WHERE id = ?"
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
        db.log_audit(user_id, "UPDATE", "activos", id, Some(&old_nombre), Some(&activo.nombre))
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

    // Obtener nombre del activo para auditoría
    let activo_nombre: Option<String> = sqlx::query_scalar("SELECT nombre FROM activos WHERE id = ?")
        .bind(id)
        .fetch_optional(db.pool())
        .await
        .map_err(|e| format!("Error al obtener activo: {}", e))?;

    sqlx::query("DELETE FROM activos WHERE id = ?")
        .bind(id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al eliminar activo: {}", e))?;

    // Registrar auditoría
    if let Some(nombre) = activo_nombre {
        db.log_audit(user_id, "DELETE", "activos", id, Some(&nombre), None)
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

    // Registrar auditoría
    db.log_audit(admin_id, "UPDATE", "usuarios", user_id, None, Some(&format!("Rol cambiado a: {}", new_role)))
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

    sqlx::query("DELETE FROM usuarios WHERE id = ?")
        .bind(user_id)
        .execute(db.pool())
        .await
        .map_err(|e| format!("Error al eliminar usuario: {}", e))?;

    // Registrar auditoría
    if let Some(name) = username {
        db.log_audit(admin_id, "DELETE", "usuarios", user_id, Some(&name), None)
            .await
            .map_err(|e| format!("Error al registrar auditoría: {}", e))?;
    }

    Ok("Usuario eliminado exitosamente".to_string())
}

/// Comando para obtener el log de auditoría
#[tauri::command]
pub async fn get_audit_log(
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let limit_value = limit.unwrap_or(100);

    let logs = sqlx::query(
        r#"
        SELECT a.id, a.usuario_id as user_id, u.username, a.accion as action, a.tabla as table_name, 
               a.registro_id as record_id, a.datos_anteriores as old_value, a.datos_nuevos as new_value, a.timestamp
        FROM auditoria a
        LEFT JOIN usuarios u ON a.usuario_id = u.id
        ORDER BY a.timestamp DESC
        LIMIT ?
        "#,
    )
    .bind(limit_value)
    .fetch_all(db.pool())
    .await
    .map_err(|e| format!("Error al obtener log de auditoría: {}", e))?;

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
    db.log_audit(user_id, "UPDATE", "usuarios", user_id, Some("password"), Some("***"))
        .await
        .map_err(|e| format!("Error al registrar auditoría: {}", e))?;

    Ok("Contraseña actualizada exitosamente".to_string())
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
    db.log_audit(user_id, "UPDATE", "usuarios", user_id, Some(&old_username), Some(&new_username))
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
        SELECT a.*, u.username as created_by_username
        FROM activos a
        LEFT JOIN usuarios u ON a.created_by = u.id
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

    // Registrar auditoría
    db.log_audit(user_id, "UPDATE", "activos", activo_id, None, Some("Actualizada fecha de vencimiento"))
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
    db.log_audit(user_id, "UPDATE", "usuarios", user_id, None, Some(&format!("Zona horaria actualizada a: {}", timezone)))
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
    db.log_audit(user_id, "CREATE", "categorias", categoria_id, None, Some(&format!("Creada categoría: {}", categoria.nombre)))
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
        db.log_audit(user_id, "DELETE", "categorias", id, Some(&cat_nombre), None)
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

    db.log_audit(user_id, "CREATE", "keywords", keyword_id, None, Some(&format!("Creada keyword: {}", keyword.palabra)))
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
        db.log_audit(user_id, "DELETE", "keywords", id, Some(&kw), None)
            .await
            .map_err(|e| format!("Error al registrar auditoría: {}", e))?;
    }

    Ok("Keyword eliminada exitosamente".to_string())
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

