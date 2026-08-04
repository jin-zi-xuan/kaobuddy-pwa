use crate::models::AppData;

#[cfg(feature = "web")]
const STORAGE_KEY: &str = "kaobuddy-rust-v2";

#[cfg(feature = "web")]
pub fn load() -> AppData {
    web_sys::window()
        .and_then(|window| window.local_storage().ok().flatten())
        .and_then(|storage| storage.get_item(STORAGE_KEY).ok().flatten())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

#[cfg(not(feature = "web"))]
pub fn load() -> AppData {
    AppData::default()
}

#[cfg(feature = "web")]
pub fn save(data: &AppData) {
    if let (Some(storage), Ok(raw)) = (
        web_sys::window().and_then(|window| window.local_storage().ok().flatten()),
        serde_json::to_string(data),
    ) {
        let _ = storage.set_item(STORAGE_KEY, &raw);
    }
}

#[cfg(not(feature = "web"))]
pub fn save(_data: &AppData) {}
