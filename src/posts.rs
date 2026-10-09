use crate::{
    Actor, AppState,
    api::require_restaurant,
    error::{AppError, Result},
    media,
    models::*,
};
use axum::{
    Extension, Json,
    extract::{FromRequest, Multipart, Path, Query, Request, State},
    http::StatusCode,
};

const POST_SELECT: &str = "SELECT p.*, (SELECT COUNT(*) FROM votes WHERE post_id=p.id AND value=1) AS likes, (SELECT COUNT(*) FROM votes WHERE post_id=p.id AND value=-1) AS dislikes, COALESCE((SELECT value FROM votes WHERE post_id=p.id AND voter_id=?),0) AS my_vote FROM posts p";
async fn attach_images(s: &AppState, posts: &mut [Post]) -> Result<()> {
    for post in posts {
        post.images = sqlx::query_as("SELECT i.id, '/media/' || i.id || '?v=' || i.md5 AS url FROM images i JOIN post_images pi ON pi.image_id=i.id WHERE pi.post_id=? ORDER BY pi.position")
            .bind(&post.id).fetch_all(&s.db).await?;
    }
    Ok(())
}
pub async fn list(
    State(s): State<AppState>,
    Extension(actor): Extension<Actor>,
    Query(page): Query<Page>,
) -> Result<Json<Vec<Post>>> {
    let sort = page.sort.as_deref().unwrap_or("latest");
    let order = match sort {
        "latest" => "p.created_at DESC,p.id DESC",
        "oldest" => "p.created_at ASC,p.id ASC",
        "liked" => "likes DESC,p.created_at DESC,p.id DESC",
        "eaten" => "p.eaten_on DESC,p.created_at DESC,p.id DESC",
        _ => return Err(AppError::bad("不支持的排序方式")),
    };
    let offset = page.offset.unwrap_or(0);
    if !(0..=1_000_000).contains(&offset) {
        return Err(AppError::bad("分页范围不正确"));
    }
    if page.before.is_some() && (sort != "latest" || offset != 0) {
        return Err(AppError::bad(
            "时间游标只能用于最新排序，且不能同时使用 offset",
        ));
    }
    let mut query = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
        "SELECT p.*, (SELECT COUNT(*) FROM votes WHERE post_id=p.id AND value=1) AS likes, (SELECT COUNT(*) FROM votes WHERE post_id=p.id AND value=-1) AS dislikes, COALESCE((SELECT value FROM votes WHERE post_id=p.id AND voter_id=",
    );
    query
        .push_bind(actor.0)
        .push("),0) AS my_vote FROM posts p JOIN restaurants r ON r.id=p.restaurant_id WHERE 1=1");
    if let Some(id) = page.restaurant_id {
        valid_id(&id)?;
        query.push(" AND p.restaurant_id=").push_bind(id);
    }
    if let Some(id) = page.meal_id {
        valid_id(&id)?;
        query.push(" AND p.shared_meal_id=").push_bind(id);
    }
    if let Some(nickname) = page.nickname {
        if nickname.chars().count() > 40 {
            return Err(AppError::bad("昵称最多 40 字"));
        }
        query.push(" AND p.nickname=").push_bind(nickname);
    }
    if let Some(ids) = page.ids {
        let ids: Vec<_> = ids.split(',').filter(|id| !id.is_empty()).collect();
        if ids.len() > 200 {
            return Err(AppError::bad("一次最多查询 200 条分享编号"));
        }
        for id in &ids {
            valid_id(id)?;
        }
        if ids.is_empty() {
            query.push(" AND 0=1");
        } else {
            query.push(" AND p.id IN (");
            let mut values = query.separated(",");
            for id in ids {
                values.push_bind(id.to_owned());
            }
            values.push_unseparated(")");
        }
    }
    for (date, condition) in [
        (&page.start, " AND p.eaten_on >= "),
        (&page.end, " AND p.eaten_on <= "),
    ] {
        if let Some(date) = date {
            valid_date(date)?;
            query.push(condition).push_bind(date.clone());
        }
    }
    if matches!((&page.start, &page.end), (Some(start), Some(end)) if start > end) {
        return Err(AppError::bad("开始日期不能晚于结束日期"));
    }
    if let Some(search) = page.q {
        if search.chars().count() > 200 {
            return Err(AppError::bad("搜索内容最多 200 字"));
        }
        // Bind literal tokens and escape LIKE wildcards; all tokens must match.
        for token in search.split_whitespace() {
            let pattern = format!(
                "%{}%",
                token
                    .replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_")
            );
            query
                .push(" AND (p.body LIKE ")
                .push_bind(pattern.clone())
                .push(" ESCAPE '\\' OR p.nickname LIKE ")
                .push_bind(pattern.clone())
                .push(" ESCAPE '\\' OR r.name LIKE ")
                .push_bind(pattern)
                .push(" ESCAPE '\\')");
        }
    }
    if let Some(before) = page.before {
        query
            .push(" AND (p.created_at < ")
            .push_bind(before)
            .push(" OR (p.created_at = ")
            .push_bind(before)
            .push(" AND p.id < ")
            .push_bind(page.before_id.unwrap_or_default())
            .push("))");
    }
    query
        .push(" ORDER BY ")
        .push(order)
        .push(" LIMIT 20 OFFSET ")
        .push_bind(offset);
    let mut posts = query.build_query_as::<Post>().fetch_all(&s.db).await?;
    attach_images(&s, &mut posts).await?;
    Ok(Json(posts))
}
pub async fn authors(State(s): State<AppState>) -> Result<Json<Vec<PostAuthor>>> {
    Ok(Json(sqlx::query_as("SELECT nickname, COUNT(*) AS count FROM posts GROUP BY nickname ORDER BY count DESC,nickname ASC").fetch_all(&s.db).await?))
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

async fn multipart_input<T: serde::de::DeserializeOwned>(
    mut multipart: Multipart,
) -> Result<(T, Vec<media::Upload>)> {
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
                    serde_json::from_slice::<T>(&bytes)
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
    Ok((input, files))
}

pub async fn create(
    State(s): State<AppState>,
    Extension(actor): Extension<Actor>,
    multipart: Multipart,
) -> Result<Json<Post>> {
    let (input, files): (PostInput, _) = multipart_input(multipart).await?;
    valid_id(&input.id)?;
    valid_date(&input.eaten_on)?;
    valid_rating(input.meal_rating)?;
    valid_cost(input.cost_cents)?;
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
        let mut cost = input.cost_cents;
        if let Some(id) = &input.existing_meal_id {
            let meal: Option<Meal> = sqlx::query_as("SELECT * FROM meals WHERE id=? AND restaurant_id=? AND eaten_on=?")
                .bind(id).bind(&input.restaurant_id).bind(&input.eaten_on).fetch_optional(&mut *tx).await?;
            let meal = meal.ok_or_else(|| AppError::conflict("关联的聚餐记录已变化，请刷新后重试"))?;
            cost = meal.cost_cents;
            shared_meal_id = Some(id.clone());
        } else if input.record_meal {
            let id = uuid::Uuid::new_v4().to_string();
            sqlx::query("INSERT INTO meals(id,restaurant_id,eaten_on,created_at,rating,cost_cents) VALUES (?,?,?,?,?,?)").bind(&id).bind(&input.restaurant_id).bind(&input.eaten_on).bind(now()).bind(input.meal_rating).bind(cost).execute(&mut *tx).await?;
            shared_meal_id = Some(id);
        }
        sqlx::query("INSERT INTO posts(id,restaurant_id,eaten_on,nickname,body,shared_meal_id,created_at,cost_cents) VALUES (?,?,?,?,?,?,?,?)")
            .bind(&input.id).bind(&input.restaurant_id).bind(&input.eaten_on).bind(input.nickname.trim()).bind(input.body.trim()).bind(shared_meal_id).bind(now()).bind(cost).execute(&mut *tx).await?;
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
    request: Request,
) -> Result<StatusCode> {
    let is_multipart = request
        .headers()
        .get("content-type")
        .and_then(|h| h.to_str().ok())
        .is_some_and(|h| h.starts_with("multipart/form-data"));
    let (input, files): (PostEdit, Vec<media::Upload>) = if is_multipart {
        let multipart = Multipart::from_request(request, &s)
            .await
            .map_err(|_| AppError::bad("上传格式不正确"))?;
        multipart_input(multipart).await?
    } else {
        let Json(input) = Json::<PostEdit>::from_request(request, &s)
            .await
            .map_err(|_| AppError::bad("分享格式不正确"))?;
        (input, Vec::new())
    };
    valid_text(&input.nickname, &input.body)?;
    valid_cost(input.cost_cents.flatten())?;
    let _lock = s.writes.lock().await;
    let original = one(&s, &id, "").await?;
    let cost = input.cost_cents.unwrap_or(original.cost_cents);
    let restaurant = input
        .restaurant_id
        .as_deref()
        .unwrap_or(&original.restaurant_id);
    let date = input.eaten_on.as_deref().unwrap_or(&original.eaten_on);
    valid_date(date)?;
    require_restaurant(&s, restaurant, false).await?;
    let changed = restaurant != original.restaurant_id
        || date != original.eaten_on
        || cost != original.cost_cents;
    let keep = input.keep_image_ids.unwrap_or_else(|| {
        original
            .images
            .iter()
            .map(|image| image.id.clone())
            .collect()
    });
    let keep: std::collections::BTreeSet<_> = keep.into_iter().collect();
    if keep
        .iter()
        .any(|id| !original.images.iter().any(|image| &image.id == id))
    {
        return Err(AppError::bad("照片不属于这条分享"));
    }
    if keep.len() + files.len() > 6 {
        return Err(AppError::bad("每条分享最多 6 张照片"));
    }
    if input.body.trim().is_empty() && keep.is_empty() && files.is_empty() {
        return Err(AppError::bad("正文和照片不能同时为空"));
    }
    let mut tx = s.db.begin().await?;
    let mut created_files = Vec::new();
    let operation: Result<()> = async {
        if changed && original.shared_meal_id.is_some() {
            return Err(AppError::bad("这条分享已绑定用餐记录，请在用餐历史中修改饭店、日期和花费"));
        }
        sqlx::query("UPDATE posts SET restaurant_id=?,eaten_on=?,nickname=?,body=?,shared_meal_id=?,cost_cents=? WHERE id=?")
            .bind(restaurant).bind(date).bind(input.nickname.trim()).bind(input.body.trim()).bind(&original.shared_meal_id).bind(cost).bind(&id).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM post_images WHERE post_id=?").bind(&id).execute(&mut *tx).await?;
        let retained: Vec<_> = original.images.iter().filter(|image| keep.contains(&image.id)).collect();
        for (position, image) in retained.iter().enumerate() {
            sqlx::query("INSERT INTO post_images VALUES(?,?,?)").bind(&id).bind(&image.id).bind(position as i64).execute(&mut *tx).await?;
        }
        for (position, upload) in files.iter().enumerate() {
            let image_id = media::store(&s, &mut tx, upload, &mut created_files).await?;
            sqlx::query("INSERT OR IGNORE INTO post_images VALUES(?,?,?)").bind(&id).bind(image_id).bind((retained.len()+position) as i64).execute(&mut *tx).await?;
        }
        sqlx::query("UPDATE images SET pending_delete=1 WHERE NOT EXISTS (SELECT 1 FROM post_images WHERE image_id=images.id)").execute(&mut *tx).await?;
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
    if let Err(error) = media::cleanup_locked(&s).await {
        tracing::warn!(%error, "post edited; media cleanup will retry");
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
