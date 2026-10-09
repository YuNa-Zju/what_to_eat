use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Serialize, FromRow)]
pub struct Restaurant {
    pub id: String,
    pub name: String,
    pub active: bool,
    pub address: Option<String>,
    #[sqlx(json(nullable))]
    pub location: Option<Location>,
    #[sqlx(skip)]
    pub cover: Option<PostImage>,
}
#[derive(Serialize, FromRow)]
pub struct Meal {
    pub id: String,
    pub restaurant_id: String,
    pub eaten_on: String,
    pub created_at: i64,
    pub rating: Option<i64>,
    pub cost_cents: Option<i64>,
}
#[derive(Serialize, Deserialize)]
pub struct Settings {
    pub window_size: i64,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Location {
    pub lng: f64,
    pub lat: f64,
    pub coordinate_system: String,
    pub poi_id: Option<String>,
}
#[derive(Deserialize)]
pub struct RestaurantInput {
    pub name: String,
    pub active: bool,
    #[serde(default, deserialize_with = "present")]
    pub address: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    pub location: Option<Option<Location>>,
    #[serde(default, deserialize_with = "present")]
    pub cover_upload_id: Option<Option<String>>,
}
fn present<'de, D, T>(d: D) -> std::result::Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}
#[derive(Deserialize)]
pub struct MealInput {
    pub id: String,
    pub restaurant_id: String,
    pub eaten_on: String,
    pub rating: Option<i64>,
    #[serde(default, deserialize_with = "present_cost")]
    pub cost_cents: Option<Option<i64>>,
}
#[derive(Serialize, FromRow)]
pub struct Post {
    pub id: String,
    pub restaurant_id: String,
    pub eaten_on: String,
    pub nickname: String,
    pub body: String,
    pub shared_meal_id: Option<String>,
    pub cost_cents: Option<i64>,
    pub created_at: i64,
    pub likes: i64,
    pub dislikes: i64,
    pub my_vote: i64,
    #[sqlx(skip)]
    pub images: Vec<PostImage>,
}
#[derive(Serialize, FromRow)]
pub struct PostImage {
    pub id: String,
    pub url: String,
}
#[derive(Deserialize)]
pub struct PostInput {
    #[serde(default)]
    pub upload_ids: Vec<String>,
    pub id: String,
    pub restaurant_id: String,
    pub eaten_on: String,
    pub nickname: String,
    pub body: String,
    #[serde(default)]
    pub record_meal: bool,
    pub existing_meal_id: Option<String>,
    pub meal_rating: Option<i64>,
    pub cost_cents: Option<i64>,
}
#[derive(Deserialize)]
pub struct PostEdit {
    #[serde(default)]
    pub upload_ids: Vec<String>,
    pub nickname: String,
    pub body: String,
    pub restaurant_id: Option<String>,
    pub eaten_on: Option<String>,
    pub keep_image_ids: Option<Vec<String>>,
    #[serde(default, deserialize_with = "present_cost")]
    pub cost_cents: Option<Option<i64>>,
}
#[derive(Deserialize)]
pub struct VoteInput {
    pub value: i64,
}
#[derive(Deserialize)]
pub struct Page {
    pub before: Option<i64>,
    pub before_id: Option<String>,
    pub offset: Option<i64>,
    pub sort: Option<String>,
    pub q: Option<String>,
    pub restaurant_id: Option<String>,
    pub nickname: Option<String>,
    pub meal_id: Option<String>,
    pub ids: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
}

#[derive(Serialize, FromRow)]
pub struct PostAuthor {
    pub nickname: String,
    pub count: i64,
}

pub fn valid_id(id: &str) -> Result<()> {
    uuid::Uuid::parse_str(id).map_err(|_| AppError::bad("无效的记录编号"))?;
    Ok(())
}
pub fn valid_date(value: &str) -> Result<()> {
    let date = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| AppError::bad("日期格式应为 YYYY-MM-DD"))?;
    if date.format("%Y-%m-%d").to_string() != value {
        return Err(AppError::bad("日期格式应为 YYYY-MM-DD"));
    }
    Ok(())
}
pub fn valid_rating(value: Option<i64>) -> Result<()> {
    if value.is_some_and(|rating| !(-1..=1).contains(&rating)) {
        return Err(AppError::bad("用餐评价须为喜欢、一般、不喜欢或未评价"));
    }
    Ok(())
}
// Absent fields preserve an existing amount; explicit null clears it.
fn present_cost<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<Option<i64>>, D::Error> {
    Option::<i64>::deserialize(deserializer).map(Some)
}
pub fn valid_cost(value: Option<i64>) -> Result<()> {
    if value.is_some_and(|cents| !(0..=99_999_999).contains(&cents)) {
        return Err(AppError::bad("本次总花费须为 0–999999.99 元，最多两位小数"));
    }
    Ok(())
}
pub fn valid_text(nickname: &str, body: &str) -> Result<()> {
    if nickname.chars().count() > 40 || body.chars().count() > 10000 {
        return Err(AppError::bad("昵称最多 40 字，正文最多 10000 字"));
    }
    Ok(())
}
pub fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
