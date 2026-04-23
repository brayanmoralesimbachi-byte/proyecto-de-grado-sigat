use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};

/// Genera un hash seguro de una contraseña usando Argon2id
/// 
/// Argon2id es el algoritmo de hash de contraseñas más seguro actualmente,
/// ganador del Password Hashing Competition. Combina resistencia a ataques
/// de canal lateral (Argon2i) y GPU (Argon2d).
/// 
/// # Arguments
/// * `password` - Contraseña en texto plano
/// 
/// # Returns
/// Tupla con (hash_completo, sal) para almacenar en la base de datos
pub fn hash_password(password: &str) -> Result<(String, String), String> {
    // Generar sal criptográficamente segura
    let salt = SaltString::generate(&mut OsRng);
    
    // Configurar Argon2id con parámetros seguros
    // m_cost: 19456 KiB de memoria (19 MB)
    // t_cost: 2 iteraciones
    // p_cost: 1 thread de paralelismo
    let argon2 = Argon2::default();

    // Generar hash
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| format!("Error al hashear contraseña: {}", e))?
        .to_string();

    Ok((password_hash, salt.to_string()))
}

/// Verifica una contraseña contra su hash almacenado
/// 
/// # Arguments
/// * `password` - Contraseña en texto plano a verificar
/// * `password_hash` - Hash completo almacenado en la base de datos
/// 
/// # Returns
/// `true` si la contraseña es correcta, `false` en caso contrario
pub fn verify_password(password: &str, password_hash: &str) -> Result<bool, String> {
    let parsed_hash = PasswordHash::new(password_hash)
        .map_err(|e| format!("Error al parsear hash: {}", e))?;

    let argon2 = Argon2::default();

    match argon2.verify_password(password.as_bytes(), &parsed_hash) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_and_verify() {
        let password = "MiContraseñaSegura123!";
        let (hash, _salt) = hash_password(password).unwrap();
        
        assert!(verify_password(password, &hash).unwrap());
        assert!(!verify_password("ContraseñaIncorrecta", &hash).unwrap());
    }

}
