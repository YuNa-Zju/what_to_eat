use crate::{
    Actor, AppState, cache,
    error::{AppError, Result},
    models::*,
};
use axum::{
    Extension, Json,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};

pub async fn health(State(s): State<AppState>) -> Result<Json<serde_json::Value>> {
    sqlx::query("SELECT 1").execute(&s.db).await?;
    Ok(Json(serde_json::json!({"ok": true})))
}
pub async fn restaurants(State(s): State<AppState>, headers: HeaderMap) -> Result<Response> {
    let mut rows: Vec<Restaurant> = sqlx::query_as(
        "SELECT id,name,active,address,location FROM restaurants ORDER BY created_at,id",
    )
    .fetch_all(&s.db)
    .await?;
    for row in &mut rows {
        load_cover(&s, row).await?;
    }
    let bytes = serde_json::to_vec(&rows).map_err(|error| {
        tracing::error!(%error, "restaurant serialization failed");
        AppError(StatusCode::INTERNAL_SERVER_ERROR, "读取饭店名单失败".into())
    })?;
    let etag = cache::etag(&bytes);
    let response = if cache::matches(&headers, &etag) {
        StatusCode::NOT_MODIFIED.into_response()
    } else {
        ([("content-type", "application/json")], Body::from(bytes)).into_response()
    };
    Ok(cache::with_headers(response, &etag, "private, no-cache"))
}
fn restaurant_name(name: &str) -> Result<&str> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(AppError::bad("饭店名称请填写 1–80 个字"));
    }
    Ok(name)
}
async fn check_duplicate(s: &AppState, name: &str, except: &str) -> Result<()> {
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM restaurants WHERE name = ? AND id != ?")
            .bind(name)
            .bind(except)
            .fetch_one(&s.db)
            .await?;
    if count > 0 {
        return Err(AppError::conflict("这家店已经存在，请检查完整名单"));
    }
    Ok(())
}
async fn load_cover(s: &AppState, row: &mut Restaurant) -> Result<()> {
    row.cover = sqlx::query_as("SELECT i.id, '/media/' || i.id || '?v=' || i.md5 AS url FROM images i JOIN restaurants r ON r.cover_image_id=i.id WHERE r.id=?")
        .bind(&row.id).fetch_optional(&s.db).await?;
    Ok(())
}
fn validate_details(input: &RestaurantInput) -> Result<()> {
    if input
        .address
        .as_ref()
        .and_then(|v| v.as_ref())
        .is_some_and(|v| v.chars().count() > 300)
    {
        return Err(AppError::bad("地址最多 300 字"));
    }
    if let Some(Some(p)) = &input.location {
        if p.coordinate_system != "gcj02"
            || !p.lng.is_finite()
            || !p.lat.is_finite()
            || !(-180.0..=180.0).contains(&p.lng)
            || !(-90.0..=90.0).contains(&p.lat)
            || p.poi_id.as_ref().is_some_and(|id| id.len() > 128)
        {
            return Err(AppError::bad("无效的地图位置"));
        }
    }
    Ok(())
}
async fn save_details(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    input: &RestaurantInput,
    id: &str,
    actor: &str,
) -> Result<()> {
    if let Some(address) = &input.address {
        let address = address.as_deref().map(str::trim).filter(|v| !v.is_empty());
        sqlx::query("UPDATE restaurants SET address=? WHERE id=?")
            .bind(address)
            .bind(id)
            .execute(&mut **tx)
            .await?;
    }
    if let Some(location) = &input.location {
        let value = location
            .as_ref()
            .map(|p| serde_json::to_string(p).expect("validated location"));
        sqlx::query("UPDATE restaurants SET location=? WHERE id=?")
            .bind(value)
            .bind(id)
            .execute(&mut **tx)
            .await?;
    }
    if let Some(upload) = &input.cover_upload_id {
        let image = if let Some(upload) = upload {
            valid_id(upload)?;
            let image: String = sqlx::query_scalar("SELECT image_id FROM photo_uploads WHERE id=? AND visitor_id=? AND expires_at>? AND post_id IS NULL AND (restaurant_id IS NULL OR restaurant_id=?)")
                .bind(upload).bind(actor).bind(now()).bind(id).fetch_optional(&mut **tx).await?
                .ok_or_else(|| AppError::bad("封面上传已失效，请重新选择照片"))?;
            sqlx::query("UPDATE photo_uploads SET restaurant_id=? WHERE id=?")
                .bind(id)
                .bind(upload)
                .execute(&mut **tx)
                .await?;
            sqlx::query("UPDATE images SET pending_delete=0 WHERE id=?")
                .bind(&image)
                .execute(&mut **tx)
                .await?;
            Some(image)
        } else {
            None
        };
        sqlx::query("UPDATE restaurants SET cover_image_id=? WHERE id=?")
            .bind(image)
            .bind(id)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}
pub async fn create_restaurant(
    State(s): State<AppState>,
    Extension(actor): Extension<Actor>,
    Json(input): Json<RestaurantInput>,
) -> Result<Json<Restaurant>> {
    let name = restaurant_name(&input.name)?;
    validate_details(&input)?;
    let _lock = s.writes.lock().await;
    check_duplicate(&s, name, "").await?;
    let id = uuid::Uuid::new_v4().to_string();
    let mut tx = s.db.begin().await?;
    sqlx::query("INSERT INTO restaurants(id,name,active,created_at) VALUES (?,?,?,?)")
        .bind(&id)
        .bind(name)
        .bind(input.active)
        .bind(now())
        .execute(&mut *tx)
        .await?;
    save_details(&mut tx, &input, &id, &actor.0).await?;
    tx.commit().await?;
    let mut row: Restaurant =
        sqlx::query_as("SELECT id,name,active,address,location FROM restaurants WHERE id=?")
            .bind(id)
            .fetch_one(&s.db)
            .await?;
    load_cover(&s, &mut row).await?;
    Ok(Json(row))
}
pub async fn edit_restaurant(
    State(s): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
    Json(input): Json<RestaurantInput>,
) -> Result<StatusCode> {
    let name = restaurant_name(&input.name)?;
    validate_details(&input)?;
    let _lock = s.writes.lock().await;
    check_duplicate(&s, name, &id).await?;
    let mut tx = s.db.begin().await?;
    let result = sqlx::query("UPDATE restaurants SET name=?,active=? WHERE id=?")
        .bind(name)
        .bind(input.active)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::missing());
    }
    save_details(&mut tx, &input, &id, &actor.0).await?;
    tx.commit().await?;
    if crate::media::cleanup_locked(&s).await.is_err() {
        tracing::warn!("cover cleanup will retry");
    }
    Ok(StatusCode::NO_CONTENT)
}
pub async fn settings(State(s): State<AppState>) -> Result<Json<Settings>> {
    let window_size = sqlx::query_scalar("SELECT window_size FROM settings WHERE id=1")
        .fetch_one(&s.db)
        .await?;
    Ok(Json(Settings { window_size }))
}
pub async fn edit_settings(
    State(s): State<AppState>,
    Json(input): Json<Settings>,
) -> Result<Json<Settings>> {
    if !(1..=100).contains(&input.window_size) {
        return Err(AppError::bad("窗口长度请填写 1–100 的整数"));
    }
    let _lock = s.writes.lock().await;
    sqlx::query("UPDATE settings SET window_size=? WHERE id=1")
        .bind(input.window_size)
        .execute(&s.db)
        .await?;
    Ok(Json(input))
}
pub async fn meals(State(s): State<AppState>) -> Result<Json<Vec<Meal>>> {
    Ok(Json(
        sqlx::query_as("SELECT * FROM meals ORDER BY eaten_on DESC,created_at DESC,id DESC")
            .fetch_all(&s.db)
            .await?,
    ))
}
pub async fn require_restaurant(s: &AppState, id: &str, active: bool) -> Result<()> {
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM restaurants WHERE id=? AND (active=1 OR ?=0)")
            .bind(id)
            .bind(active)
            .fetch_one(&s.db)
            .await?;
    if count == 0 {
        return Err(AppError::bad("请选择现有的启用饭店"));
    }
    Ok(())
}
pub async fn create_meal(
    State(s): State<AppState>,
    Json(input): Json<MealInput>,
) -> Result<Json<Meal>> {
    valid_id(&input.id)?;
    valid_date(&input.eaten_on)?;
    valid_rating(input.rating)?;
    let cost = input.cost_cents.flatten();
    valid_cost(cost)?;
    let _lock = s.writes.lock().await;
    let existing: Option<Meal> = sqlx::query_as("SELECT * FROM meals WHERE id=?")
        .bind(&input.id)
        .fetch_optional(&s.db)
        .await?;
    if let Some(meal) = existing {
        if meal.restaurant_id != input.restaurant_id
            || meal.eaten_on != input.eaten_on
            || meal.rating != input.rating
            || meal.cost_cents != cost
        {
            return Err(AppError::conflict("此操作已提交，请刷新后重试"));
        }
        return Ok(Json(meal));
    }
    require_restaurant(&s, &input.restaurant_id, true).await?;
    let created_at = now();
    sqlx::query(
        "INSERT INTO meals(id,restaurant_id,eaten_on,created_at,rating,cost_cents) VALUES (?,?,?,?,?,?)",
    )
    .bind(&input.id)
    .bind(&input.restaurant_id)
    .bind(&input.eaten_on)
    .bind(created_at)
    .bind(input.rating)
    .bind(cost)
    .execute(&s.db)
    .await?;
    Ok(Json(Meal {
        id: input.id,
        restaurant_id: input.restaurant_id,
        eaten_on: input.eaten_on,
        created_at,
        rating: input.rating,
        cost_cents: cost,
    }))
}
pub async fn edit_meal(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<MealInput>,
) -> Result<StatusCode> {
    valid_date(&input.eaten_on)?;
    valid_rating(input.rating)?;
    valid_cost(input.cost_cents.flatten())?;
    let _lock = s.writes.lock().await;
    let original: Meal = sqlx::query_as("SELECT * FROM meals WHERE id=?")
        .bind(&id)
        .fetch_optional(&s.db)
        .await?
        .ok_or_else(AppError::missing)?;
    let cost = input.cost_cents.unwrap_or(original.cost_cents);
    // Existing history may continue to reference a retired restaurant.
    require_restaurant(&s, &input.restaurant_id, false).await?;
    let mut tx = s.db.begin().await?;
    let result =
        sqlx::query("UPDATE meals SET restaurant_id=?,eaten_on=?,rating=?,cost_cents=? WHERE id=?")
            .bind(&input.restaurant_id)
            .bind(&input.eaten_on)
            .bind(input.rating)
            .bind(cost)
            .bind(&id)
            .execute(&mut *tx)
            .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::missing());
    }
    sqlx::query("UPDATE posts SET restaurant_id=?,eaten_on=?,cost_cents=? WHERE shared_meal_id=?")
        .bind(&input.restaurant_id)
        .bind(&input.eaten_on)
        .bind(cost)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
pub async fn delete_meal(State(s): State<AppState>, Path(id): Path<String>) -> Result<StatusCode> {
    let _lock = s.writes.lock().await;
    let mut tx = s.db.begin().await?;
    sqlx::query("UPDATE posts SET shared_meal_id=NULL WHERE shared_meal_id=?")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM meals WHERE id=?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
