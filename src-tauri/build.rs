fn main() {
    tauri_build::build();

    // Leer variables del .env para que estén disponibles como option_env!() en db.rs
    let env_path = std::path::Path::new(".env");
    if let Ok(content) = std::fs::read_to_string(env_path) {
        for line in content.lines() {
            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim();
                let value = value.trim();
                if key == "APP_DEFAULT_ADMIN_USERNAME" || key == "APP_DEFAULT_ADMIN_PASSWORD" {
                    println!("cargo:rustc-env={}={}", key, value);
                    println!("cargo:rerun-if-env-changed={}", key);
                }
            }
        }
    }
}
