#![cfg_attr(
    all(feature = "bundle", target_os = "windows"),
    windows_subsystem = "windows"
)]

mod bilibili;
mod client;
mod models;
#[cfg(feature = "server")]
mod server;
mod storage;
mod ui;

use ui::App;

#[cfg(feature = "desktop")]
fn main() {
    use dioxus::desktop::{Config, LogicalSize, WindowBuilder};

    dioxus::LaunchBuilder::desktop()
        .with_cfg(
            Config::new().with_menu(None).with_window(
                WindowBuilder::new()
                    .with_title("KaoBuddy 考研搭子")
                    .with_inner_size(LogicalSize::new(1280.0, 820.0))
                    .with_min_inner_size(LogicalSize::new(920.0, 640.0)),
            ),
        )
        .launch(App);
}

#[cfg(all(feature = "server", not(feature = "desktop")))]
fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "kaobuddy=info,tower_http=info".into()),
        )
        .init();

    dioxus::serve(|| async move {
        let router = dioxus::server::router(App)
            .merge(server::api_router())
            .layer(server::security_headers())
            .layer(server::cors_layer())
            .layer(tower_http::trace::TraceLayer::new_for_http());
        Ok(router)
    });
}

#[cfg(all(feature = "web", not(feature = "desktop"), not(feature = "server")))]
fn main() {
    dioxus::launch(App);
}
