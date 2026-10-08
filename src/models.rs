use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Serialize, FromRow)]
pub struct Restaurant {
    pub id: String,
    pub name: String,
    pub active: bool,
}
#[derive(Serialize, FromRow)]
pub struct Meal {
    pub id: String,
    pub restaurant_id: String,
    pub eaten_on: String,
    pub created_at: i64,
    pub rating: Option<i64>,
}
#[derive(Serialize, Deserialize)]
pub struct Settings {
    pub window_size: i64,
}
#[derive(Deserialize)]
pub struct RestaurantInput {
    pub name: String,
    pub active: bool,
}
#[derive(Deserialize)]
pub struct MealInput {
    pub id: String,
    pub restaurant_id: String,
    pub eaten_on: String,
    pub rating: Option<i64>,
}
#[derive(Serialize, FromRow)]
pub struct Post {
    pub id: String,
    pub restaurant_id: String,
    pub eaten_on: String,
    pub nickname: String,
    pub body: String,
    pub shared_meal_id: Option<String>,
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
    pub id: String,
    pub restaurant_id: String,
    pub eaten_on: String,
    pub nickname: String,
    pub body: String,
    #[serde(default)]
    pub record_meal: bool,
    pub existing_meal_id: Option<String>,
    pub meal_rating: Option<i64>,
}
#[derive(Deserialize)]
pub struct PostEdit {
    pub nickname: String,
    pub body: String,
}
#[derive(Deserialize)]
pub struct VoteInput {
    pub value: i64,
}
#[derive(Deserialize)]
pub struct Page {
    pub before: Option<i64>,
    pub before_id: Option<String>,
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
pub fn valid_text(nickname: &str, body: &str) -> Result<()> {
    if nickname.chars().count() > 40 || body.chars().count() > 10000 {
        return Err(AppError::bad("昵称最多 40 字，正文最多 10000 字"));
    }
    Ok(())
}
pub fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
