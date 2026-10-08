use crate::{
    AppState,
    error::{AppError, Result},
    models::now,
};
use axum::{
    body::Body,
    extract::{Path, State},
    http::{HeaderValue, StatusCode},
    response::Response,
};
use md5::{Digest, Md5};
use sqlx::{FromRow, Sqlite, Transaction};
use std::{
    io::Cursor,
    path::PathBuf,
    time::{Duration, SystemTime},
};
use tokio::io::AsyncReadExt;

pub struct Upload {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
    pub ext: &'static str,
    pub digest: String,
}
#[derive(FromRow)]
struct ImageRow {
    id: String,
    path: String,
    mime: String,
}

pub async fn validate(bytes: Vec<u8>) -> Result<Upload> {
    if bytes.is_empty() || bytes.len() > 10 * 1024 * 1024 {
        return Err(AppError::bad("每张照片需在 10 MiB 以内"));
    }
    tokio::task::spawn_blocking(move || {
        let format = image::guess_format(&bytes).map_err(|_| AppError::bad("无法识别图片"))?;
        let (mime, ext) = match format {
            image::ImageFormat::Jpeg => ("image/jpeg", "jpg"),
            image::ImageFormat::Png => ("image/png", "png"),
            image::ImageFormat::WebP => ("image/webp", "webp"),
            _ => return Err(AppError::bad("仅支持 JPEG、PNG 和 WebP 图片")),
        };
        let (w, h) = image::ImageReader::with_format(Cursor::new(&bytes), format)
            .into_dimensions()
            .map_err(|_| AppError::bad("图片已损坏"))?;
        if w == 0 || h == 0 || u64::from(w) * u64::from(h) > 25_000_000 {
            return Err(AppError::bad("图片最多支持 2500 万像素，请缩小后上传"));
        }
        image::load_from_memory_with_format(&bytes, format)
            .map_err(|_| AppError::bad("图片无法完整读取"))?;
        let digest = format!("{:x}", Md5::digest(&bytes));
        Ok(Upload {
            bytes,
            mime,
            ext,
            digest,
        })
    })
    .await
    .map_err(|_| AppError::bad("图片处理失败"))?
}

// Caller holds the single-instance write lock through file + database changes.
pub async fn store(
    s: &AppState,
    tx: &mut Transaction<'_, Sqlite>,
    upload: &Upload,
    created: &mut Vec<PathBuf>,
) -> Result<String> {
    let candidates: Vec<ImageRow> =
        sqlx::query_as("SELECT id,path,mime FROM images WHERE md5=? AND size=?")
            .bind(&upload.digest)
            .bind(upload.bytes.len() as i64)
            .fetch_all(&mut **tx)
            .await?;
    for candidate in candidates {
        let existing = tokio::fs::read(s.data_dir.join(&candidate.path)).await;
        if existing.as_deref().ok() == Some(upload.bytes.as_slice()) {
            sqlx::query("UPDATE images SET pending_delete=0 WHERE id=?")
                .bind(&candidate.id)
                .execute(&mut **tx)
                .await?;
            return Ok(candidate.id);
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let relative = format!("uploads/{id}.{}", upload.ext);
    let temporary = s.data_dir.join("tmp").join(&id);
    created.push(temporary.clone());
    tokio::fs::write(&temporary, &upload.bytes).await?;
    let destination = s.data_dir.join(&relative);
    created.push(destination.clone());
    tokio::fs::rename(&temporary, &destination).await?;
    sqlx::query("INSERT INTO images(id,md5,size,mime,path,created_at) VALUES (?,?,?,?,?,?)")
        .bind(&id)
        .bind(&upload.digest)
        .bind(upload.bytes.len() as i64)
        .bind(upload.mime)
        .bind(relative)
        .bind(now())
        .execute(&mut **tx)
        .await?;
    Ok(id)
}

pub async fn rollback_files(s: &AppState, paths: &[PathBuf]) {
    for path in paths {
        let Ok(relative) = path.strip_prefix(&s.data_dir) else {
            continue;
        };
        let referenced = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM images WHERE path=?")
            .bind(relative.to_string_lossy().as_ref())
            .fetch_one(&s.db)
            .await;
        if matches!(referenced, Ok(0)) {
            if let Err(error) = tokio::fs::remove_file(path).await {
                if error.kind() != std::io::ErrorKind::NotFound {
                    tracing::warn!(%error, "orphan file will be retried");
                }
            }
        }
    }
}

pub async fn serve(State(s): State<AppState>, Path(id): Path<String>) -> Result<Response> {
    crate::models::valid_id(&id)?;
    // Serialize open/read with deletion so a successful lookup cannot race unlink.
    let _lock = s.writes.lock().await;
    let row: ImageRow = sqlx::query_as("SELECT id,path,mime FROM images WHERE id=? AND EXISTS (SELECT 1 FROM post_images WHERE image_id=images.id)")
        .bind(id).fetch_optional(&s.db).await?.ok_or_else(AppError::missing)?;
    let mut file = tokio::fs::File::open(s.data_dir.join(row.path))
        .await
        .map_err(|_| AppError::missing())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).await?;
    let mut response = Response::new(Body::from(bytes));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        "content-type",
        HeaderValue::from_str(&row.mime).map_err(|_| AppError::missing())?,
    );
    response
        .headers_mut()
        .insert("cache-control", HeaderValue::from_static("no-cache"));
    Ok(response)
}

pub async fn cleanup(s: &AppState) -> Result<()> {
    let _lock = s.writes.lock().await;
    cleanup_locked(s).await
}
pub async fn cleanup_locked(s: &AppState) -> Result<()> {
    sqlx::query("UPDATE images SET pending_delete=1 WHERE NOT EXISTS (SELECT 1 FROM post_images WHERE image_id=images.id)").execute(&s.db).await?;
    let rows: Vec<ImageRow> = sqlx::query_as("SELECT id,path,mime FROM images WHERE pending_delete=1 AND NOT EXISTS (SELECT 1 FROM post_images WHERE image_id=images.id)").fetch_all(&s.db).await?;
    for row in rows {
        match tokio::fs::remove_file(s.data_dir.join(&row.path)).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                tracing::warn!(%error, image_id=%row.id, "image deletion will retry");
                continue;
            }
        }
        sqlx::query("DELETE FROM images WHERE id=?")
            .bind(row.id)
            .execute(&s.db)
            .await?;
    }
    // Crash recovery: only inspect server-owned directories, never user filenames.
    for folder in ["tmp", "uploads"] {
        let mut entries = tokio::fs::read_dir(s.data_dir.join(folder)).await?;
        while let Some(entry) = entries.next_entry().await? {
            let metadata = entry.metadata().await?;
            if !metadata.is_file()
                || SystemTime::now()
                    .duration_since(metadata.modified()?)
                    .unwrap_or_default()
                    < Duration::from_secs(3600)
            {
                continue;
            }
            let relative = format!("{folder}/{}", entry.file_name().to_string_lossy());
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM images WHERE path=?")
                .bind(relative)
                .fetch_one(&s.db)
                .await?;
            if count == 0 {
                if let Err(error) = tokio::fs::remove_file(entry.path()).await {
                    tracing::warn!(%error, "orphan cleanup will retry");
                }
            }
        }
    }
    Ok(())
}
