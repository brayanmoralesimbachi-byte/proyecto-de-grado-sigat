use app_lib::crypto::{hash_password, verify_password};
use app_lib::security::load_or_create_db_key;

#[test]
fn key_generation_is_fast_enough() {
    let temp_dir = tempfile::tempdir().expect("debe crear tempdir");

    let start = std::time::Instant::now();
    let key = load_or_create_db_key(temp_dir.path()).expect("debe generar clave");
    let elapsed = start.elapsed();

    assert!(!key.is_empty());
    assert!(elapsed.as_millis() < 300, "generación de clave lenta: {:?}", elapsed);
}

#[test]
fn password_hash_and_verify_are_within_thresholds() {
    let password = "Seguridad!2026";

    let hash_start = std::time::Instant::now();
    let (hash, _) = hash_password(password).expect("debe generar hash");
    let hash_elapsed = hash_start.elapsed();

    let verify_start = std::time::Instant::now();
    let valid = verify_password(password, &hash).expect("debe verificar hash");
    let verify_elapsed = verify_start.elapsed();

    assert!(valid);
    assert!(hash_elapsed.as_millis() < 1500, "hash lento: {:?}", hash_elapsed);
    assert!(verify_elapsed.as_millis() < 1500, "verify lento: {:?}", verify_elapsed);
}
