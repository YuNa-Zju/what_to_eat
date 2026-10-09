use crate::{
    Actor, AppState,
    error::{AppError, Result},
    media,
    models::{now, valid_id},
};
use axum::{
    Extension, Json,
    body::Bytes,
    extract::{Path, State},
    http::StatusCode,
};
use serde::Serialize;
use sqlx::{Sqlite, Transaction};

const LIFETIME_MS: i64 = 24 * 60 * 60 * 1000;

#[derive(Serialize)]
pub struct UploadedPhoto {
    id: String,
    expires_at: i64,
}

async fn existing(s: &AppState, id: &str, actor: &str) -> Result<Option<UploadedPhoto>> {
    let row: Option<(String, i64)> =
        sqlx::query_as("SELECT visitor_id,expires_at FROM photo_uploads WHERE id=?")
            .bind(id)
            .fetch_optional(&s.db)
            .await?;
    if let Some((owner, expires_at)) = row {
        if owner != actor {
            return Err(AppError::conflict("照片上传编号已被使用，请重新添加照片"));
        }
        if expires_at > now() {
            let expires_at = now() + LIFETIME_MS;
            sqlx::query("UPDATE photo_uploads SET expires_at=? WHERE id=?")
                .bind(expires_at)
                .bind(id)
                .execute(&s.db)
                .await?;
            return Ok(Some(UploadedPhoto {
                id: id.into(),
                expires_at,
            }));
        }
    }
    Ok(None)
}

pub async fn put(
    State(s): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
    bytes: Bytes,
) -> Result<Json<UploadedPhoto>> {
    valid_id(&id)?;
    {
        let _lock = s.writes.lock().await;
        if let Some(upload) = existing(&s, &id, &actor.0).await? {
            return Ok(Json(upload));
        }
    }
    // Decode outside the write lock so uploads don't block normal browsing/writes.
    let upload = media::validate(bytes.to_vec()).await?;
    let _lock = s.writes.lock().await;
    if let Some(upload) = existing(&s, &id, &actor.0).await? {
        return Ok(Json(upload));
    }
    let mut tx = s.db.begin().await?;
    let mut created_files = Vec::new();
    let expires_at = now() + LIFETIME_MS;
    let operation: Result<()> = async {
        sqlx::query("DELETE FROM photo_uploads WHERE id=?")
            .bind(&id)
            .execute(&mut *tx)
            .await?;
        let image = media::store(&s, &mut tx, &upload, &mut created_files).await?;
        sqlx::query("INSERT INTO photo_uploads(id,image_id,visitor_id,expires_at) VALUES(?,?,?,?)")
            .bind(&id)
            .bind(image)
            .bind(&actor.0)
            .bind(expires_at)
            .execute(&mut *tx)
            .await?;
        Ok(())
    }
    .await;
    if let Err(error) = operation {
        let _ = tx.rollback().await;
        media::rollback_files(&s, &created_files).await;
        return Err(error);
    }
    if let Err(error) = tx.commit().await {
        media::rollback_files(&s, &created_files).await;
        return Err(error.into());
    }
    Ok(Json(UploadedPhoto { id, expires_at }))
}

pub async fn delete(
    State(s): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    valid_id(&id)?;
    let _lock = s.writes.lock().await;
    sqlx::query("DELETE FROM photo_uploads WHERE id=? AND visitor_id=?")
        .bind(id)
        .bind(actor.0)
        .execute(&s.db)
        .await?;
    if let Err(error) = media::cleanup_locked(&s).await {
        tracing::warn!(%error, "discarded upload cleanup will retry");
    }
    Ok(StatusCode::NO_CONTENT)
}

pub fn validate_ids(ids: &[String], other_photos: usize) -> Result<()> {
    if ids.len() + other_photos > 6 {
        return Err(AppError::bad("每条分享最多 6 张照片"));
    }
    let mut unique = std::collections::HashSet::new();
    for id in ids {
        valid_id(id)?;
        if !unique.insert(id) {
            return Err(AppError::bad("照片上传编号不能重复"));
        }
    }
    Ok(())
}

// The same receipt can retry an edit after a lost response, but cannot be used
// by another visitor or attached to a different post.
pub async fn attach(
    tx: &mut Transaction<'_, Sqlite>,
    ids: &[String],
    actor: &str,
    post: &str,
    offset: usize,
) -> Result<()> {
    for (position, id) in ids.iter().enumerate() {
        let image: Option<String> = sqlx::query_scalar("SELECT image_id FROM photo_uploads WHERE id=? AND visitor_id=? AND expires_at>? AND (post_id IS NULL OR post_id=?)")
            .bind(id).bind(actor).bind(now()).bind(post).fetch_optional(&mut **tx).await?;
        let image = image.ok_or_else(|| AppError::bad("照片上传已失效，请移除后重新添加"))?;
        sqlx::query("INSERT OR IGNORE INTO post_images VALUES(?,?,?)")
            .bind(post)
            .bind(image)
            .bind((offset + position) as i64)
            .execute(&mut **tx)
            .await?;
        sqlx::query("UPDATE photo_uploads SET post_id=? WHERE id=?")
            .bind(post)
            .bind(id)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}
