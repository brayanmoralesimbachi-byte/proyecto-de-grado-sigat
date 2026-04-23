use app_lib::{db::Database, security::load_or_create_db_key};

#[tokio::test]
async fn database_initializes_and_records_audit_entries() {
    let temp_dir = tempfile::tempdir().expect("debe crear tempdir");
    let db_path = temp_dir.path().join("security-test.db");
    let encryption_key = load_or_create_db_key(temp_dir.path()).expect("debe generar clave");

    let database = Database::new(db_path, &encryption_key)
        .await
        .expect("debe conectar a la base de datos");

    database.initialize().await.expect("debe inicializar tablas");
    sqlx::query(
        r#"
        INSERT INTO usuarios (id, username, password_hash, salt, rol)
        VALUES (1, 'tester', 'hash', 'salt', 'admin')
        "#,
    )
    .execute(database.pool())
    .await
    .expect("debe crear usuario de prueba");

    database
        .log_audit(1, "CREATE", "usuarios", 1, None, Some("evento de seguridad"))
        .await
        .expect("debe registrar auditoría");

    let audit_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM auditoria")
        .fetch_one(database.pool())
        .await
        .expect("debe leer auditoría");

    assert_eq!(audit_count, 1);
}