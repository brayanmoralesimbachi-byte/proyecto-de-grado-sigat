use app_lib::crypto::{hash_password, verify_password};

#[test]
fn password_hash_round_trip_is_valid() {
    let password = "MiContraseñaSegura123!";
    let (hash, salt) = hash_password(password).expect("debe generar hash");

    assert!(!salt.trim().is_empty());
    assert!(verify_password(password, &hash).expect("debe verificar"));
    assert!(!verify_password("OtraClave", &hash).expect("debe rechazar"));
}