use crate::{
    Actor, AppState,
    api::require_restaurant,
    error::{AppError, Result},
    media,
    models::*,
};
use axum::{
    Extension, Json,
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
};

const POST_SELECT: &str = "SELECT p.*, (SELECT COUNT(*) FROM votes WHERE post_id=p.id AND value=1) AS likes, (SELECT COUNT(*) FROM votes WHERE post_id=p.id AND value=-1) AS dislikes, COALESCE((SELECT value FROM votes WHERE post_id=p.id AND voter_id=?),0) AS my_vote FROM posts p";
async fn attach_images(s: &AppState, posts: &mut [Post]) -> Result<()> {
    for post in posts {
        post.images = sqlx::query_as("SELECT i.id, '/media/' || i.id AS url FROM images i JOIN post_images pi ON pi.image_id=i.id WHERE pi.post_id=? ORDER BY pi.position")
            .bind(&post.id).fetch_all(&s.db).await?;
    }
    Ok(())
}
pub async fn list(
    State(s): State<AppState>,
    Extension(actor): Extension<Actor>,
    Query(page): Query<Page>,
) -> Result<Json<Vec<Post>>> {
    let query = format!(
        "{POST_SELECT} WHERE p.created_at < ? OR (p.created_at = ? AND p.id < ?) ORDER BY p.created_at DESC,p.id DESC LIMIT 20"
    );
    let before = page.before.unwrap_or(i64::MAX);
    let mut posts: Vec<Post> = sqlx::query_as(&query)
        .bind(actor.0)
        .bind(before)
        .bind(before)
        .bind(page.before_id.unwrap_or_default())
        .fetch_all(&s.db)
        .await?;
    attach_images(&s, &mut posts).await?;
    Ok(Json(posts))
}
async fn one(s: &AppState, id: &str, actor: &str) -> Result<Post> {
    let mut post: Post = sqlx::query_as(&format!("{POST_SELECT} WHERE p.id=?"))
        .bind(actor)
        .bind(id)
        .fetch_optional(&s.db)
        .await?
        .ok_or_else(AppError::missing)?;
    attach_images(s, std::slice::from_mut(&mut post)).await?;
    Ok(post)
}

pub async fn create(
    State(s): State<AppState>,
    Extension(actor): Extension<Actor>,
    mut multipart: Multipart,
) -> Result<Json<Post>> {
    let mut payload = None;
    let mut files = Vec::new();
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| AppError::bad("上传失败或超过总大小限制"))?
    {
        match field.name() {
            Some("payload") if payload.is_none() => {
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|_| AppError::bad("无法读取帖子内容"))?;
                if bytes.len() > 50000 {
                    return Err(AppError::bad("帖子内容过长"));
                }
                payload = Some(
                    serde_json::from_slice::<PostInput>(&bytes)
                        .map_err(|_| AppError::bad("帖子格式不正确"))?,
                );
            }
            Some("photos") => {
                if files.len() >= 6 {
                    return Err(AppError::bad("每帖最多 6 张照片"));
                }
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|_| AppError::bad("照片上传失败"))?;
                files.push(media::validate(bytes.to_vec()).await?);
            }
            _ => return Err(AppError::bad("上传字段不正确")),
        }
    }
    let input = payload.ok_or_else(|| AppError::bad("缺少帖子内容"))?;
    valid_id(&input.id)?;
    valid_date(&input.eaten_on)?;
    valid_rating(input.meal_rating)?;
    valid_text(&input.nickname, &input.body)?;
    if input.body.trim().is_empty() && files.is_empty() {
        return Err(AppError::bad("写点感受或添加照片再发布吧"));
    }
    let _lock = s.writes.lock().await;
    let existing: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM posts WHERE id=?")
        .bind(&input.id)
        .fetch_one(&s.db)
        .await?;
    if existing > 0 {
        return Ok(Json(one(&s, &input.id, &actor.0).await?));
    }
    require_restaurant(&s, &input.restaurant_id, false).await?;
    let mut tx = s.db.begin().await?;
    let mut created_files = Vec::new();
    let operation: Result<()> = async {
        let mut shared_meal_id = None;
        if let Some(id) = &input.existing_meal_id {
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meals WHERE id=? AND restaurant_id=? AND eaten_on=?")
                .bind(id).bind(&input.restaurant_id).bind(&input.eaten_on).fetch_one(&mut *tx).await?;
            if count == 0 { return Err(AppError::conflict("关联的聚餐记录已变化，请刷新后重试")); }
            shared_meal_id = Some(id.clone());
        } else if input.record_meal {
            let id = uuid::Uuid::new_v4().to_string();
            sqlx::query("INSERT INTO meals(id,restaurant_id,eaten_on,created_at,rating) VALUES (?,?,?,?,?)").bind(&id).bind(&input.restaurant_id).bind(&input.eaten_on).bind(now()).bind(input.meal_rating).execute(&mut *tx).await?;
            shared_meal_id = Some(id);
        }
        sqlx::query("INSERT INTO posts(id,restaurant_id,eaten_on,nickname,body,shared_meal_id,created_at) VALUES (?,?,?,?,?,?,?)")
            .bind(&input.id).bind(&input.restaurant_id).bind(&input.eaten_on).bind(input.nickname.trim()).bind(input.body.trim()).bind(shared_meal_id).bind(now()).execute(&mut *tx).await?;
        for (index, upload) in files.iter().enumerate() {
            let id = media::store(&s, &mut tx, upload, &mut created_files).await?;
            sqlx::query("INSERT OR IGNORE INTO post_images VALUES (?,?,?)").bind(&input.id).bind(id).bind(index as i64).execute(&mut *tx).await?;
        }
        Ok(())
    }.await;
    if let Err(error) = operation {
        let _ = tx.rollback().await;
        media::rollback_files(&s, &created_files).await;
        return Err(error);
    }
    if let Err(error) = tx.commit().await {
        media::rollback_files(&s, &created_files).await;
        return Err(error.into());
    }
    Ok(Json(one(&s, &input.id, &actor.0).await?))
}
pub async fn edit(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<PostEdit>,
) -> Result<StatusCode> {
    valid_text(&input.nickname, &input.body)?;
    let _lock = s.writes.lock().await;
    let photos: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM post_images WHERE post_id=?")
        .bind(&id)
        .fetch_one(&s.db)
        .await?;
    if input.body.trim().is_empty() && photos == 0 {
        return Err(AppError::bad("正文和照片不能同时为空"));
    }
    let result = sqlx::query("UPDATE posts SET nickname=?,body=? WHERE id=?")
        .bind(input.nickname.trim())
        .bind(input.body.trim())
        .bind(id)
        .execute(&s.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::missing());
    }
    Ok(StatusCode::NO_CONTENT)
}
pub async fn delete(State(s): State<AppState>, Path(id): Path<String>) -> Result<StatusCode> {
    let _lock = s.writes.lock().await;
    let mut tx = s.db.begin().await?;
    sqlx::query("DELETE FROM posts WHERE id=?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE images SET pending_delete=1 WHERE NOT EXISTS (SELECT 1 FROM post_images WHERE image_id=images.id)").execute(&mut *tx).await?;
    tx.commit().await?;
    if let Err(error) = media::cleanup_locked(&s).await {
        tracing::warn!(%error, "post deleted; media cleanup will retry");
    }
    Ok(StatusCode::NO_CONTENT)
}
pub async fn vote(
    State(s): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
    Json(input): Json<VoteInput>,
) -> Result<Json<Post>> {
    if !(-1..=1).contains(&input.value) {
        return Err(AppError::bad("投票值不正确"));
    }
    let _lock = s.writes.lock().await;
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM posts WHERE id=?")
        .bind(&id)
        .fetch_one(&s.db)
        .await?;
    if exists == 0 {
        return Err(AppError::missing());
    }
    if input.value == 0 {
        sqlx::query("DELETE FROM votes WHERE post_id=? AND voter_id=?")
            .bind(&id)
            .bind(&actor.0)
            .execute(&s.db)
            .await?;
    } else {
        sqlx::query("INSERT INTO votes VALUES (?,?,?) ON CONFLICT(post_id,voter_id) DO UPDATE SET value=excluded.value")
            .bind(&id).bind(&actor.0).bind(input.value).execute(&s.db).await?;
    }
    Ok(Json(one(&s, &id, &actor.0).await?))
}
