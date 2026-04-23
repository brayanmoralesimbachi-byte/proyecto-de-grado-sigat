use rand::RngCore;
use std::path::Path;

pub fn load_or_create_db_key(app_data_dir: &Path) -> Result<String, String> {
    let key_path = app_data_dir.join("db.key");

    if let Ok(existing_key) = std::fs::read_to_string(&key_path) {
        let trimmed_key = existing_key.trim();
        if !trimmed_key.is_empty() {
            return Ok(trimmed_key.to_string());
        }
    }

    let mut random_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut random_bytes);

    let generated_key = random_bytes
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>();

    std::fs::write(&key_path, &generated_key)
        .map_err(|e| format!("No se pudo guardar la clave de cifrado: {}", e))?;

    Ok(generated_key)
}