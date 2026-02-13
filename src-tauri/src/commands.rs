use crate::crypto::{hash_password, verify_password};
use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::sync::Mutex;
use sqlx::Row;

/// Estado compartido de la aplicación
pub struct AppState {
    pub db: Mutex<Option<crate::db::Database>>,
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
    // Hashear contraseña
    let (password_hash, salt) = hash_password(&password)?;

    // Obtener conexión a la base de datos
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

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
    let user: Option<(i64, String, String, String)> = sqlx::query_as(
        r#"
        SELECT id, username, password_hash, rol
        FROM usuarios
        WHERE username = ?
        "#,
    )
    .bind(&request.username)
    .fetch_optional(db.pool())
    .await
    .map_err(|e| format!("Error al buscar usuario: {}", e))?;

    if let Some((user_id, username, password_hash, rol)) = user {
        // Verificar contraseña
        if verify_password(&request.password, &password_hash)? {
            // Registrar auditoría de login exitoso
            db.log_audit(user_id, "LOGIN", "usuarios", user_id, None, None)
                .await
                .map_err(|e| format!("Error al registrar auditoría: {}", e))?;

            Ok(LoginResponse {
                success: true,
                message: "Login exitoso".to_string(),
                user_id: Some(user_id),
                username: Some(username),
                rol: Some(rol),
            })
        } else {
            Ok(LoginResponse {
                success: false,
                message: "Contraseña incorrecta".to_string(),
                user_id: None,
                username: None,
                rol: None,
            })
        }
    } else {
        Ok(LoginResponse {
            success: false,
            message: "Usuario no encontrado".to_string(),
            user_id: None,
            username: None,
            rol: None,
        })
    }
}

/// Comando Tauri para obtener la lista de activos
#[tauri::command]
pub async fn get_activos(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Base de datos no inicializada")?;

    let activos = sqlx::query(
        r#"
        SELECT id, codigo, nombre, descripcion, categoria, ubicacion, 
               responsable_id, estado, valor_adquisicion, fecha_adquisicion, imagen_base64
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
            "imagen_base64": row.try_get::<Option<String>, _>("imagen_base64").ok().flatten(),
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
    pub imagen_base64: Option<String>,
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
                            responsable_id, estado, valor_adquisicion, fecha_adquisicion, imagen_base64)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    .bind(&activo.imagen_base64)
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
            responsable_id = ?, estado = ?, valor_adquisicion = ?, fecha_adquisicion = ?, imagen_base64 = ?
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
    .bind(&activo.imagen_base64)
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
