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

/// Deriva una clave de cifrado para SQLCipher a partir de una contraseña maestra
/// 
/// Esta función no debe usarse directamente para hashear contraseñas de usuarios,
/// sino para derivar la clave de cifrado de la base de datos.
/// 
/// # Arguments
/// * `master_password` - Contraseña maestra del sistema
/// * `salt` - Sal única para el sistema (debe generarse una vez y almacenarse de forma segura)
/// 
/// # Returns
/// Clave de cifrado en formato hexadecimal
pub fn derive_encryption_key(master_password: &str, salt: &str) -> Result<String, String> {
    let salt_string = SaltString::from_b64(salt)
        .map_err(|e| format!("Error al procesar sal: {}", e))?;

    let argon2 = Argon2::default();
    let binding = argon2
        .hash_password(master_password.as_bytes(), &salt_string)
        .map_err(|e| format!("Error al derivar clave: {}", e))?
        .to_string();
    let hash_parts: Vec<&str> = binding.split('$').collect();
    if hash_parts.len() >= 5 {
        Ok(hash_parts[4].to_string())
    } else {
        Err("Error al extraer clave de cifrado".to_string())
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

    #[test]
    fn test_derive_encryption_key() {
        let master_password = "MasterPassword123!";
        let salt = SaltString::generate(&mut OsRng);
        
        let key1 = derive_encryption_key(master_password, salt.as_str()).unwrap();
        let key2 = derive_encryption_key(master_password, salt.as_str()).unwrap();
        
        // La misma contraseña y sal deben producir la misma clave
        assert_eq!(key1, key2);
    }
}
