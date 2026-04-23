use app_lib::security::load_or_create_db_key;

#[test]
fn db_key_is_generated_and_reused_per_installation() {
    let temp_dir = tempfile::tempdir().expect("debe crear tempdir");

    let key1 = load_or_create_db_key(temp_dir.path()).expect("debe generar clave");
    let key2 = load_or_create_db_key(temp_dir.path()).expect("debe reutilizar clave");

    assert_eq!(key1, key2);
    assert_eq!(key1.len(), 64);
    assert!(key1.chars().all(|c| c.is_ascii_hexdigit()));

    let key_path = temp_dir.path().join("db.key");
    assert!(key_path.exists());
}