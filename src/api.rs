use crate::{
    AppState,
    error::{AppError, Result},
    models::*,
};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};

pub async fn health(State(s): State<AppState>) -> Result<Json<serde_json::Value>> {
    sqlx::query("SELECT 1").execute(&s.db).await?;
    Ok(Json(serde_json::json!({"ok": true})))
}
pub async fn restaurants(State(s): State<AppState>) -> Result<Json<Vec<Restaurant>>> {
    Ok(Json(
        sqlx::query_as("SELECT id,name,active FROM restaurants ORDER BY created_at,id")
            .fetch_all(&s.db)
            .await?,
    ))
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
        return Err(AppError::conflict("这家店已经存在，请检查停用列表"));
    }
    Ok(())
}
pub async fn create_restaurant(
    State(s): State<AppState>,
    Json(input): Json<RestaurantInput>,
) -> Result<Json<Restaurant>> {
    let name = restaurant_name(&input.name)?;
    let _lock = s.writes.lock().await;
    check_duplicate(&s, name, "").await?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO restaurants(id,name,active,created_at) VALUES (?,?,?,?)")
        .bind(&id)
        .bind(name)
        .bind(input.active)
        .bind(now())
        .execute(&s.db)
        .await?;
    Ok(Json(Restaurant {
        id,
        name: name.into(),
        active: input.active,
    }))
}
pub async fn edit_restaurant(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<RestaurantInput>,
) -> Result<StatusCode> {
    let name = restaurant_name(&input.name)?;
    let _lock = s.writes.lock().await;
    check_duplicate(&s, name, &id).await?;
    let result = sqlx::query("UPDATE restaurants SET name=?,active=? WHERE id=?")
        .bind(name)
        .bind(input.active)
        .bind(id)
        .execute(&s.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::missing());
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
    let _lock = s.writes.lock().await;
    let existing: Option<Meal> = sqlx::query_as("SELECT * FROM meals WHERE id=?")
        .bind(&input.id)
        .fetch_optional(&s.db)
        .await?;
    if let Some(meal) = existing {
        if meal.restaurant_id != input.restaurant_id
            || meal.eaten_on != input.eaten_on
            || meal.rating != input.rating
        {
            return Err(AppError::conflict("此操作已提交，请刷新后重试"));
        }
        return Ok(Json(meal));
    }
    require_restaurant(&s, &input.restaurant_id, true).await?;
    let created_at = now();
    sqlx::query(
        "INSERT INTO meals(id,restaurant_id,eaten_on,created_at,rating) VALUES (?,?,?,?,?)",
    )
    .bind(&input.id)
    .bind(&input.restaurant_id)
    .bind(&input.eaten_on)
    .bind(created_at)
    .bind(input.rating)
    .execute(&s.db)
    .await?;
    Ok(Json(Meal {
        id: input.id,
        restaurant_id: input.restaurant_id,
        eaten_on: input.eaten_on,
        created_at,
        rating: input.rating,
    }))
}
pub async fn edit_meal(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<MealInput>,
) -> Result<StatusCode> {
    valid_date(&input.eaten_on)?;
    valid_rating(input.rating)?;
    let _lock = s.writes.lock().await;
    // Existing history may continue to reference a retired restaurant.
    require_restaurant(&s, &input.restaurant_id, false).await?;
    let result = sqlx::query("UPDATE meals SET restaurant_id=?,eaten_on=?,rating=? WHERE id=?")
        .bind(input.restaurant_id)
        .bind(input.eaten_on)
        .bind(input.rating)
        .bind(id)
        .execute(&s.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::missing());
    }
    Ok(StatusCode::NO_CONTENT)
}
pub async fn delete_meal(State(s): State<AppState>, Path(id): Path<String>) -> Result<StatusCode> {
    let _lock = s.writes.lock().await;
    sqlx::query("DELETE FROM meals WHERE id=?")
        .bind(id)
        .execute(&s.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
