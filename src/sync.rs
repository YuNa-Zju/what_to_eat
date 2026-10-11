//! A sync code is a bearer credential. Never place it in URLs or logs.
use crate::{
    Actor, AppState,
    error::{AppError, Result},
    models,
};
use axum::{
    Extension, Json,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PersonalMeal {
    id: String,
    restaurant_id: String,
    eaten_on: String,
    created_at: i64,
    rating: Option<i64>,
    cost_cents: Option<i64>,
    #[serde(default)]
    post_ids: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PersonalData {
    version: u8,
    window_size: i64,
    meals: Vec<PersonalMeal>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Content {
    local: PersonalData,
    nickname: String,
}
impl Content {
    fn validate(&self) -> Result<()> {
        if self.local.version != 1
            || !(1..=100).contains(&self.local.window_size)
            || self.local.meals.len() > 10000
            || self.nickname.chars().count() > 40
        {
            return Err(AppError::bad("同步内容超出限制，请检查记录、窗口和昵称"));
        }
        let mut ids = HashSet::new();
        for meal in &self.local.meals {
            models::valid_id(&meal.id)?;
            models::valid_id(&meal.restaurant_id)?;
            models::valid_date(&meal.eaten_on)?;
            models::valid_rating(meal.rating)?;
            models::valid_cost(meal.cost_cents)?;
            if !ids.insert(&meal.id)
                || meal.created_at < 0
                || meal.created_at > 8_640_000_000_000_000
                || meal.post_ids.len() > 100
            {
                return Err(AppError::bad("无效的个人用餐记录"));
            }
            for id in &meal.post_ids {
                models::valid_id(id)?;
            }
        }
        Ok(())
    }
}
#[derive(Serialize)]
pub struct Snapshot {
    revision: i64,
    content: Content,
}
#[derive(Serialize)]
pub struct Created {
    code: String,
    #[serde(flatten)]
    snapshot: Snapshot,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Update {
    revision: i64,
    content: Content,
}
fn hash(code: &str) -> String {
    format!("{:x}", Sha256::digest(code.as_bytes()))
}
fn credential(headers: &HeaderMap) -> Result<String> {
    let code = headers
        .get("x-sync-code")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if code.len() != 32 || !code.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppError(
            StatusCode::UNAUTHORIZED,
            "请输入完整的同步码".into(),
        ));
    }
    Ok(hash(&code.to_ascii_lowercase()))
}
fn missing() -> AppError {
    AppError(
        StatusCode::NOT_FOUND,
        "没有找到这个同步码，请检查后重试".into(),
    )
}
fn known_revision(headers: &HeaderMap) -> Result<Option<i64>> {
    headers
        .get("x-sync-revision")
        .map(|value| {
            value
                .to_str()
                .ok()
                .filter(|value| value.bytes().all(|b| b.is_ascii_digit()))
                .and_then(|value| value.parse::<i64>().ok())
                .filter(|revision| *revision >= 1)
                .ok_or_else(|| AppError::bad("无效的同步版本"))
        })
        .transpose()
}
fn operation_id(headers: &HeaderMap) -> Result<Option<String>> {
    headers
        .get("x-sync-operation")
        .map(|value| {
            value
                .to_str()
                .ok()
                .and_then(|value| Uuid::parse_str(value).ok())
                .map(|id| id.to_string())
                .ok_or_else(|| AppError::bad("无效的同步操作编号"))
        })
        .transpose()
}
pub async fn create(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Json(content): Json<Content>,
) -> Result<Json<Created>> {
    content.validate()?;
    let _guard = state.writes.lock().await;
    let now = models::now();
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM personal_sync WHERE creator=? AND created_at>?")
            .bind(&actor.0)
            .bind(now - 86_400_000)
            .fetch_one(&state.db)
            .await?;
    if count >= 10 {
        return Err(AppError(
            StatusCode::TOO_MANY_REQUESTS,
            "今天创建的同步码较多，请使用已有的同步码".into(),
        ));
    }
    let code = Uuid::new_v4().simple().to_string();
    sqlx::query("INSERT INTO personal_sync(code_hash,content,revision,creator,created_at,updated_at) VALUES (?,?,1,?,?,?)")
        .bind(hash(&code)).bind(serde_json::to_string(&content).expect("sync content"))
        .bind(&actor.0).bind(now).bind(now).execute(&state.db).await?;
    Ok(Json(Created {
        code,
        snapshot: Snapshot {
            revision: 1,
            content,
        },
    }))
}
pub async fn read(State(state): State<AppState>, headers: HeaderMap) -> Result<Response> {
    let code_hash = credential(&headers)?;
    // Return a consistent revision/content pair without loading the large JSON
    // value into the application when the caller already has that revision.
    let row: Option<(i64, Option<String>)> = sqlx::query_as(
        "SELECT revision, CASE WHEN revision=? THEN NULL ELSE content END FROM personal_sync WHERE code_hash=?",
    )
    .bind(known_revision(&headers)?)
    .bind(&code_hash)
    .fetch_optional(&state.db)
    .await?;
    let (revision, content) = row.ok_or_else(missing)?;
    let mut response = match content {
        None => StatusCode::NO_CONTENT.into_response(),
        Some(content) => {
            let content = serde_json::from_str(&content).map_err(|_| {
                AppError(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "同步数据暂时无法读取".into(),
                )
            })?;
            Json(Snapshot { revision, content }).into_response()
        }
    };
    response.headers_mut().insert(
        "x-sync-revision",
        HeaderValue::from_str(&revision.to_string()).expect("integer header"),
    );
    Ok(response)
}
pub async fn update(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Update>,
) -> Result<Json<Snapshot>> {
    let code_hash = credential(&headers)?;
    input.content.validate()?;
    if input.revision < 1 || input.revision == i64::MAX {
        return Err(AppError::bad("无效的同步版本"));
    }
    let operation = operation_id(&headers)?;
    let request_hash = operation
        .as_ref()
        .map(|_| hash(&serde_json::to_string(&input).expect("sync request")));
    // Other writers may read before writing inside a WAL transaction. Sharing
    // their lock prevents this update from invalidating that read snapshot.
    let _guard = state.writes.lock().await;
    let mut tx = state.db.begin().await?;
    if let Some(operation) = &operation {
        let receipt: Option<(String, i64)> = sqlx::query_as(
            "SELECT request_hash, revision FROM personal_sync_operations WHERE code_hash=? AND operation_id=?",
        )
        .bind(&code_hash)
        .bind(operation)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some((stored_hash, revision)) = receipt {
            if Some(&stored_hash) != request_hash.as_ref() {
                return Err(AppError::bad(
                    "同步操作编号已用于不同内容，请使用新的操作编号",
                ));
            }
            tx.commit().await?;
            // The request supplies its original content; the receipt need only
            // retain a hash and revision, even after other devices have edited.
            return Ok(Json(Snapshot {
                revision,
                content: input.content,
            }));
        }
    }
    let result = sqlx::query("UPDATE personal_sync SET content=?, revision=revision+1, updated_at=? WHERE code_hash=? AND revision=?")
        .bind(serde_json::to_string(&input.content).expect("sync content"))
        .bind(models::now()).bind(&code_hash).bind(input.revision).execute(&mut *tx).await?;
    if result.rows_affected() == 0 {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM personal_sync WHERE code_hash=?)")
                .bind(&code_hash)
                .fetch_one(&mut *tx)
                .await?;
        if !exists {
            return Err(missing());
        }
        return Err(AppError::conflict("另一台设备刚刚更新，正在重新合并"));
    }
    if let Some(operation) = operation {
        sqlx::query("INSERT INTO personal_sync_operations(code_hash,operation_id,request_hash,revision) VALUES (?,?,?,?)")
            .bind(&code_hash).bind(operation).bind(request_hash).bind(input.revision + 1)
            .execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(Snapshot {
        revision: input.revision + 1,
        content: input.content,
    }))
}
