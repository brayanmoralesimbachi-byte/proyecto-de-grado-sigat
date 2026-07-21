// Módulos del sistema
pub mod db;
pub mod crypto;
pub mod security;
mod commands;

use commands::{AppState, create_user, login, logout, can_close_app, force_logout, get_activos, create_activo, update_activo, 
               delete_activo, get_users, update_user_role, delete_user, get_audit_log,
               change_password, admin_change_password, change_username, get_username_history, get_activo_detalles,
               register_activo_vista, get_activo_vistas, update_fecha_vencimiento, update_timezone,
               get_categorias, create_categoria, delete_categoria,
               get_keywords, create_keyword, delete_keyword,
               get_bases_datos, create_base_datos, update_base_datos, delete_base_datos,
               get_user_bases_datos, assign_user_to_base_datos, unassign_user_from_base_datos,
               get_available_bases_datos, verify_admin_password, export_base_datos, import_base_datos};
use tokio::sync::Mutex;
use std::sync::Mutex as StdMutex;
use std::env;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Cargar variables de entorno desde .env cuando existe.
  let _ = dotenvy::dotenv();

  // Inicializar estado de la aplicación
  let app_state = AppState {
    db: Mutex::new(None),
    can_close_app: StdMutex::new(true), // Inicialmente se puede cerrar
    active_user_id: StdMutex::new(None),
    login_timestamp: StdMutex::new(None),
  };

  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .manage(app_state)
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Interceptar eventos de cierre de ventana
      let app_handle = app.handle().clone();
      if let Some(window) = app.handle().get_webview_window("main") {
        window.on_window_event(move |event| {
          if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            // Extraer el valor de can_close en un bloque interno para liberar todas las referencias
            let can_close = {
              let app_handle_clone = app_handle.clone();
              let state = app_handle_clone.state::<AppState>();
              state.can_close_app.try_lock()
                .map(|guard| *guard)
                .unwrap_or(true) // Si no podemos obtener el lock, permitimos cerrar por seguridad
            };
            
            if !can_close {
              // Prevenir cierre si hay sesión activa
              api.prevent_close();
              println!("Cierre prevenido: hay una sesión activa");
            }
          }
        });
      }

      // Intentar cargar .env desde el directorio de datos (producción)
      if let Ok(app_data_dir) = app.path().app_data_dir() {
        let env_path = app_data_dir.join(".env");
        if env_path.exists() {
          let _ = dotenvy::from_path(&env_path);
        }
      }

      // Inicializar la base de datos en el setup
      let app_handle = app.handle().clone();
      let app_data_dir = app.path().app_data_dir()
        .expect("No se pudo obtener directorio de datos");
      
      tauri::async_runtime::spawn(async move {
        std::fs::create_dir_all(&app_data_dir)
          .expect("No se pudo crear directorio de datos");

        let db_filename = env::var("APP_DB_FILENAME")
          .ok()
          .filter(|value| !value.trim().is_empty())
          .unwrap_or_else(|| "gestor_activos.db".to_string());
        let db_path = app_data_dir.join(db_filename);

        let encryption_key = match security::load_or_create_db_key(&app_data_dir) {
          Ok(key) => key,
          Err(e) => {
            eprintln!("Error al preparar la clave de cifrado: {}", e);
            return;
          }
        };
        
        match db::Database::new(db_path, &encryption_key).await {
          Ok(database) => {
            if let Err(e) = database.initialize().await {
              eprintln!("Error al inicializar base de datos: {}", e);
            } else {
              println!("Base de datos inicializada correctamente");

              // Crear administrador por defecto si no hay usuarios
              if let Err(e) = database.create_default_admin_if_needed().await {
                eprintln!("Error al crear administrador por defecto: {}", e);
              }

              // Guardar en el estado
              let app_state = app_handle.state::<AppState>();
              let mut db_lock = app_state.db.lock().await;
              *db_lock = Some(database);
            }
          }
          Err(e) => {
            eprintln!("Error al conectar a la base de datos: {}", e);
          }
        }
      });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      create_user,
      login,
      logout,
      can_close_app,
      force_logout,
      get_activos,
      create_activo,
      update_activo,
      delete_activo,
      get_users,
      update_user_role,
      delete_user,
      get_audit_log,
      change_password,
      admin_change_password,
      change_username,
      get_username_history,
      get_activo_detalles,
      register_activo_vista,
      get_activo_vistas,
      update_fecha_vencimiento,
      update_timezone,
      get_categorias,
      create_categoria,
      delete_categoria,
      get_keywords,
      create_keyword,
      delete_keyword,
      get_bases_datos,
      create_base_datos,
      update_base_datos,
      delete_base_datos,
      get_user_bases_datos,
      assign_user_to_base_datos,
      unassign_user_from_base_datos,
      get_available_bases_datos,
      verify_admin_password,
      export_base_datos,
      import_base_datos
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
