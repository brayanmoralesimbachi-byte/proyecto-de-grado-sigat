use app_lib::{db::Database, security::load_or_create_db_key};

async fn setup_db() -> (Database, tempfile::TempDir) {
    let temp_dir = tempfile::tempdir().expect("debe crear tempdir");
    let db_path = temp_dir.path().join("bases-test.db");
    let encryption_key = load_or_create_db_key(temp_dir.path()).expect("debe generar clave");
    let database = Database::new(db_path, &encryption_key)
        .await
        .expect("debe conectar a la base de datos");
    database.initialize().await.expect("debe inicializar tablas");
    (database, temp_dir)
}

async fn insert_user(db: &Database, id: i64, username: &str, rol: &str) {
    sqlx::query(
        "INSERT INTO usuarios (id, username, password_hash, salt, rol) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(id).bind(username).bind("hash").bind("salt").bind(rol)
    .execute(db.pool())
    .await
    .expect("debe insertar usuario");
}

async fn insert_base(db: &Database, id: i64, nombre: &str) {
    sqlx::query("INSERT INTO bases_datos (id, nombre) VALUES (?, ?)")
        .bind(id).bind(nombre)
        .execute(db.pool())
        .await
        .expect("debe insertar base de datos");
}

async fn assign_user(db: &Database, user_id: i64, base_id: i64) {
    sqlx::query("INSERT INTO usuario_base_datos (usuario_id, base_datos_id) VALUES (?, ?)")
        .bind(user_id).bind(base_id)
        .execute(db.pool())
        .await
        .expect("debe asignar usuario a base");
}

#[tokio::test]
async fn bases_datos_crud_works() {
    let (db, _tmp) = setup_db().await;

    insert_base(&db, 1, "Sede Facatativá").await;
    insert_base(&db, 2, "Sede Bogotá").await;
    insert_base(&db, 3, "Sede Medellín").await;

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bases_datos")
        .fetch_one(db.pool())
        .await
        .expect("debe leer bases_datos");
    assert_eq!(count, 3);

    sqlx::query("DELETE FROM bases_datos WHERE id = ?")
        .bind(3)
        .execute(db.pool())
        .await
        .expect("debe eliminar base");
    let count2: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bases_datos")
        .fetch_one(db.pool())
        .await
        .expect("debe leer bases_datos");
    assert_eq!(count2, 2);
}

#[tokio::test]
async fn admin_sees_all_bases() {
    let (db, _tmp) = setup_db().await;
    insert_base(&db, 1, "Base A").await;
    insert_base(&db, 2, "Base B").await;
    insert_user(&db, 10, "admin", "administrador").await;

    let ids = db.get_user_base_datos_ids(10)
        .await
        .expect("admin debe obtener todas las bases");
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&1));
    assert!(ids.contains(&2));
}

#[tokio::test]
async fn non_admin_only_sees_assigned_bases() {
    let (db, _tmp) = setup_db().await;
    insert_base(&db, 1, "Base A").await;
    insert_base(&db, 2, "Base B").await;
    insert_base(&db, 3, "Base C").await;
    insert_user(&db, 20, "operador", "operador").await;

    assign_user(&db, 20, 1).await;
    assign_user(&db, 20, 3).await;

    let ids = db.get_user_base_datos_ids(20)
        .await
        .expect("operador debe obtener sus bases asignadas");
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&1));
    assert!(!ids.contains(&2));
    assert!(ids.contains(&3));
}

#[tokio::test]
async fn check_access_works_for_assigned_user() {
    let (db, _tmp) = setup_db().await;
    insert_base(&db, 1, "Base X").await;
    insert_user(&db, 30, "operador", "operador").await;
    assign_user(&db, 30, 1).await;

    let has = db.check_base_datos_access(30, 1)
        .await
        .expect("debe verificar acceso");
    assert!(has);

    let no_has = db.check_base_datos_access(30, 999)
        .await
        .expect("debe verificar acceso");
    assert!(!no_has);
}

#[tokio::test]
async fn admin_has_access_to_any_base() {
    let (db, _tmp) = setup_db().await;
    insert_base(&db, 1, "Base Y").await;
    insert_user(&db, 40, "admin", "administrador").await;

    let has = db.check_base_datos_access(40, 1)
        .await
        .expect("debe verificar acceso");
    assert!(has);

    // Admin has access even to non-existent bases
    let has_anyway = db.check_base_datos_access(40, 999)
        .await
        .expect("debe verificar acceso");
    assert!(has_anyway);
}

#[tokio::test]
async fn activo_filters_by_base_datos_id() {
    let (db, _tmp) = setup_db().await;
    insert_base(&db, 1, "Base Alpha").await;
    insert_base(&db, 2, "Base Beta").await;
    insert_user(&db, 50, "admin", "administrador").await;

    sqlx::query(
        "INSERT INTO activos (codigo, nombre, categoria, estado, base_datos_id) VALUES (?, ?, ?, ?, ?)"
    )
    .bind("A001").bind("Activo Alpha").bind("Equipos").bind("operativo").bind(1)
    .execute(db.pool())
    .await
    .expect("debe insertar activo");

    sqlx::query(
        "INSERT INTO activos (codigo, nombre, categoria, estado, base_datos_id) VALUES (?, ?, ?, ?, ?)"
    )
    .bind("B001").bind("Activo Beta").bind("Equipos").bind("operativo").bind(2)
    .execute(db.pool())
    .await
    .expect("debe insertar activo");

    let count_alpha: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM activos WHERE base_datos_id = ?")
        .bind(1)
        .fetch_one(db.pool())
        .await
        .expect("debe contar activos");
    assert_eq!(count_alpha, 1);

    let count_all: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM activos")
        .fetch_one(db.pool())
        .await
        .expect("debe contar activos");
    assert_eq!(count_all, 2);
}
