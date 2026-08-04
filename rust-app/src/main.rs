mod bilibili;
mod client;
mod models;
#[cfg(feature = "server")]
mod server;
mod storage;
mod ui;

use ui::App;

fn main() {
    #[cfg(feature = "server")]
    {
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

    #[cfg(not(feature = "server"))]
    dioxus::launch(App);
}
