use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

#[derive(Debug)]
pub struct AppError(pub StatusCode, pub String);
pub type Result<T> = std::result::Result<T, AppError>;
impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.1)
    }
}
impl std::error::Error for AppError {}

impl AppError {
    pub fn bad(message: &str) -> Self {
        Self(StatusCode::BAD_REQUEST, message.into())
    }
    pub fn missing() -> Self {
        Self(StatusCode::NOT_FOUND, "内容不存在或已被删除".into())
    }
    pub fn conflict(message: &str) -> Self {
        Self(StatusCode::CONFLICT, message.into())
    }
}
impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error": self.1}))).into_response()
    }
}
impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        tracing::error!(%error, "database operation failed");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "保存失败，请稍后重试".into(),
        )
    }
}
impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        tracing::error!(%error, "file operation failed");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "文件处理失败，请稍后重试".into(),
        )
    }
}
