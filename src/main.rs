use std::{path::PathBuf, time::Duration};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "what_to_eat=info,tower_http=info".into()),
        )
        .init();
    let data = PathBuf::from(std::env::var("DATA_DIR").unwrap_or_else(|_| "data".into()));
    let assets =
        PathBuf::from(std::env::var("STATIC_DIR").unwrap_or_else(|_| "frontend/dist".into()));
    if !assets.join("index.html").is_file() {
        return Err(
            "未找到前端产物，请先在 frontend 运行 npm ci && npm run build，或设置 STATIC_DIR"
                .into(),
        );
    }
    let state = what_to_eat::init(
        &data,
        std::env::var("COOKIE_SECURE").as_deref() == Ok("true"),
    )
    .await?;
    what_to_eat::media::cleanup(&state).await?;
    let cleaner = state.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(300)).await;
            if let Err(error) = what_to_eat::media::cleanup(&cleaner).await {
                tracing::warn!(message = %error.1, "media cleanup will retry");
            }
        }
    });
    let bind = std::env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:3000".into());
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(%bind, "今天吃什么已启动");
    axum::serve(listener, what_to_eat::router(state, assets))
        .with_graceful_shutdown(async {
            #[cfg(unix)]
            {
                let mut terminate =
                    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                        .expect("install SIGTERM handler");
                tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
            }
            #[cfg(not(unix))]
            {
                let _ = tokio::signal::ctrl_c().await;
            }
        })
        .await?;
    Ok(())
}
