//! A sync code is a bearer credential. Never place it in URLs or logs.
use crate::{
    Actor, AppState,
    error::{AppError, Result},
    models,
};
use axum::{
    Extension, Json,
    extract::State,
    http::{HeaderMap, StatusCode},
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
#[derive(Deserialize)]
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
async fn snapshot(state: &AppState, code_hash: &str) -> Result<Snapshot> {
    let row: Option<(i64, String)> =
        sqlx::query_as("SELECT revision, content FROM personal_sync WHERE code_hash=?")
            .bind(code_hash)
            .fetch_optional(&state.db)
            .await?;
    let (revision, content) = row.ok_or_else(|| {
        AppError(
            StatusCode::NOT_FOUND,
            "没有找到这个同步码，请检查后重试".into(),
        )
    })?;
    let content = serde_json::from_str(&content).map_err(|_| {
        AppError(
            StatusCode::INTERNAL_SERVER_ERROR,
            "同步数据暂时无法读取".into(),
        )
    })?;
    Ok(Snapshot { revision, content })
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
pub async fn read(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Snapshot>> {
    Ok(Json(snapshot(&state, &credential(&headers)?).await?))
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
    let result = sqlx::query("UPDATE personal_sync SET content=?, revision=revision+1, updated_at=? WHERE code_hash=? AND revision=?")
        .bind(serde_json::to_string(&input.content).expect("sync content"))
        .bind(models::now()).bind(&code_hash).bind(input.revision).execute(&state.db).await?;
    if result.rows_affected() == 0 {
        snapshot(&state, &code_hash).await?;
        return Err(AppError::conflict("另一台设备刚刚更新，正在重新合并"));
    }
    Ok(Json(Snapshot {
        revision: input.revision + 1,
        content: input.content,
    }))
}
