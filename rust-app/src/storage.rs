use crate::models::AppData;

#[cfg(feature = "desktop")]
fn data_path() -> Option<std::path::PathBuf> {
    directories::ProjectDirs::from("cn", "KaoBuddy", "KaoBuddy")
        .map(|dirs| dirs.data_local_dir().join("kaobuddy-data.json"))
}

#[cfg(feature = "desktop")]
pub fn load() -> AppData {
    data_path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

#[cfg(feature = "desktop")]
pub fn save(data: &AppData) {
    let Some(path) = data_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(raw) = serde_json::to_string_pretty(data) {
        let _ = std::fs::write(path, raw);
    }
}

#[cfg(all(feature = "web", not(feature = "desktop")))]
const STORAGE_KEY: &str = "kaobuddy-rust-v2";

#[cfg(all(feature = "web", not(feature = "desktop")))]
pub fn load() -> AppData {
    web_sys::window()
        .and_then(|window| window.local_storage().ok().flatten())
        .and_then(|storage| storage.get_item(STORAGE_KEY).ok().flatten())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

#[cfg(all(feature = "web", not(feature = "desktop")))]
pub fn save(data: &AppData) {
    if let (Some(storage), Ok(raw)) = (
        web_sys::window().and_then(|window| window.local_storage().ok().flatten()),
        serde_json::to_string(data),
    ) {
        let _ = storage.set_item(STORAGE_KEY, &raw);
    }
}

#[cfg(not(any(feature = "web", feature = "desktop")))]
pub fn load() -> AppData {
    AppData::default()
}

#[cfg(not(any(feature = "web", feature = "desktop")))]
pub fn save(_data: &AppData) {}
