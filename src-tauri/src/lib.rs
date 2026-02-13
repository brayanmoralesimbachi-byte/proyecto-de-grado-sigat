// Módulos del sistema
mod db;
mod crypto;
mod commands;

use commands::{AppState, create_user, login, get_activos, create_activo, update_activo, 
               delete_activo, get_users, update_user_role, delete_user, get_audit_log,
               change_password, change_username, get_username_history};
use tokio::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Inicializar estado de la aplicación
  let app_state = AppState {
    db: Mutex::new(None),
  };

  tauri::Builder::default()
    .manage(app_state)
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Inicializar la base de datos en el setup
      // NOTA: En producción, la clave de cifrado debe derivarse de credenciales del usuario
      // Este es solo un ejemplo para desarrollo
      let app_handle = app.handle().clone();
      let app_data_dir = app.path().app_data_dir()
        .expect("No se pudo obtener directorio de datos");
      
      tauri::async_runtime::spawn(async move {
        std::fs::create_dir_all(&app_data_dir)
          .expect("No se pudo crear directorio de datos");

        let db_path = app_data_dir.join("gestor_activos.db");
        
        // TODO: Derivar clave de cifrado desde credenciales de usuario
        let encryption_key = "clave_temporal_desarrollo"; 
        
        match db::Database::new(db_path, encryption_key).await {
          Ok(database) => {
            if let Err(e) = database.initialize().await {
              eprintln!("Error al inicializar base de datos: {}", e);
            } else {
              println!("Base de datos inicializada correctamente");
              
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
      get_activos,
      create_activo,
      update_activo,
      delete_activo,
      get_users,
      update_user_role,
      delete_user,
      get_audit_log,
      change_password,
      change_username,
      get_username_history
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
