pub mod api;
mod cache;
pub mod error;
pub mod maps;
pub mod media;
pub mod models;
pub mod posts;
pub mod uploads;

use axum::{
    Router,
    extract::{DefaultBodyLimit, Request, State},
    http::{HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::sync::Mutex;
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub data_dir: PathBuf,
    // A single service instance owns this database and upload directory.
    pub writes: Arc<Mutex<()>>,
    pub secure_cookie: bool,
    pub maps: Option<maps::MapConfig>,
}
#[derive(Clone)]
pub struct Actor(pub String);

pub async fn init(
    data_dir: &Path,
    secure_cookie: bool,
) -> Result<AppState, Box<dyn std::error::Error>> {
    tokio::fs::create_dir_all(data_dir.join("uploads")).await?;
    tokio::fs::create_dir_all(data_dir.join("tmp")).await?;
    let options = SqliteConnectOptions::new()
        .filename(data_dir.join("app.sqlite"))
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(10));
    let db = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;
    sqlx::migrate!().run(&db).await?;
    let mut tx = db.begin().await?;
    let seeded: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM metadata WHERE key = 'seeded'")
        .fetch_one(&mut *tx)
        .await?;
    if seeded == 0 {
        let names: Vec<String> =
            serde_json::from_str(include_str!("../resources/restaurants.json"))?;
        for name in names {
            sqlx::query("INSERT OR IGNORE INTO restaurants(id,name,created_at) VALUES (?,?,?)")
                .bind(Uuid::new_v4().to_string())
                .bind(name)
                .bind(models::now())
                .execute(&mut *tx)
                .await?;
        }
        sqlx::query("INSERT INTO metadata VALUES ('seeded','1')")
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(AppState {
        db,
        data_dir: data_dir.to_path_buf(),
        writes: Arc::new(Mutex::new(())),
        secure_cookie,
        maps: maps::MapConfig::from_env(),
    })
}

pub fn router(state: AppState, static_dir: PathBuf) -> Router {
    let api = Router::new()
        .route("/health", get(api::health))
        .route("/maps/config", get(maps::config))
        .route(
            "/restaurants",
            get(api::restaurants).post(api::create_restaurant),
        )
        .route("/restaurants/{id}", put(api::edit_restaurant))
        .route("/settings", get(api::settings).put(api::edit_settings))
        .route("/meals", get(api::meals).post(api::create_meal))
        .route("/meals/{id}", put(api::edit_meal).delete(api::delete_meal))
        .route(
            "/uploads/{id}",
            put(uploads::put)
                .delete(uploads::delete)
                .layer(DefaultBodyLimit::max(10 * 1024 * 1024)),
        )
        .route("/posts", get(posts::list).post(posts::create))
        .route("/posts/authors", get(posts::authors))
        .route("/posts/{id}", put(posts::edit).delete(posts::delete))
        .route("/posts/{id}/vote", post(posts::vote))
        .fallback(|| async {
            (
                StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({"error":"接口不存在"})),
            )
        })
        .layer(DefaultBodyLimit::max(62 * 1024 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), visitor));
    let files = Router::new()
        // Missing assets must be 404s, never an HTML fallback cached as JavaScript.
        .nest_service("/assets", ServeDir::new(static_dir.join("assets")))
        .fallback_service(
            ServeDir::new(&static_dir)
                .not_found_service(ServeFile::new(static_dir.join("index.html"))),
        )
        .layer(middleware::from_fn(cache::static_headers));
    Router::new()
        .nest("/api", api)
        .route("/media/{id}", get(media::serve))
        .route("/_AMapService/{*path}", get(maps::proxy))
        .fallback_service(files)
        .layer(TraceLayer::new_for_http())
        .layer(middleware::from_fn_with_state(
            state.maps.is_some(),
            security_headers,
        ))
        .with_state(state)
}

async fn visitor(State(state): State<AppState>, mut request: Request, next: Next) -> Response {
    if request.method() != Method::GET && request.method() != Method::HEAD {
        if let Some(origin) = request.headers().get("origin") {
            let origin = origin
                .to_str()
                .ok()
                .and_then(|s| s.parse::<axum::http::Uri>().ok());
            let host = request.headers().get("host").and_then(|h| h.to_str().ok());
            if origin
                .as_ref()
                .and_then(|u| u.authority())
                .map(|a| a.as_str())
                != host
                || host.is_none()
            {
                return error::AppError(StatusCode::FORBIDDEN, "请从本站页面提交操作".into())
                    .into_response();
            }
        }
    }
    let previous = request
        .headers()
        .get("cookie")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| {
            s.split(';')
                .find_map(|part| part.trim().strip_prefix("wte_visitor="))
        })
        .filter(|s| Uuid::parse_str(s).is_ok())
        .map(str::to_owned);
    let actor = previous
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    request.extensions_mut().insert(Actor(actor.clone()));
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .entry("cache-control")
        .or_insert(HeaderValue::from_static("no-store"));
    if previous.is_none() {
        let secure = if state.secure_cookie { "; Secure" } else { "" };
        let cookie = format!(
            "wte_visitor={actor}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=31536000{secure}"
        );
        if let Ok(value) = HeaderValue::from_str(&cookie) {
            response.headers_mut().insert("set-cookie", value);
        }
    }
    response
}
async fn security_headers(
    State(maps_enabled): State<bool>,
    request: Request,
    next: Next,
) -> Response {
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .entry("cache-control")
        .or_insert(HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    response.headers_mut().insert(
        "referrer-policy",
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    // AMap JS 2.0 generates its renderer at runtime. Only enable this SDK
    // capability when maps are configured; inline scripts remain forbidden.
    let policy = if maps_enabled {
        "default-src 'self'; script-src 'self' 'unsafe-eval' https://webapi.amap.com https://*.amap.com; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://*.amap.com https://*.autonavi.com; connect-src 'self' https://*.amap.com https://*.autonavi.com; worker-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    } else {
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    };
    response
        .headers_mut()
        .insert("content-security-policy", HeaderValue::from_static(policy));
    response
}
