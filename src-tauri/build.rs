fn main() {
    tauri_build::build();
    println!("cargo:rerun-if-env-changed=APP_DEFAULT_ADMIN_USERNAME");
    println!("cargo:rerun-if-env-changed=APP_DEFAULT_ADMIN_PASSWORD");
}
