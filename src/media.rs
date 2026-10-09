use crate::{
    AppState, cache,
    error::{AppError, Result},
    models::now,
};
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use image::ImageDecoder;
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
}

pub async fn validate(bytes: Vec<u8>) -> Result<Upload> {
    if bytes.is_empty() || bytes.len() > 10 * 1024 * 1024 {
        return Err(AppError::bad("每张照片需在 10 MiB 以内"));
    }
    tokio::task::spawn_blocking(move || {
        let format = image::guess_format(&bytes).map_err(|_| AppError::bad("无法识别图片"))?;
        if !matches!(
            format,
            image::ImageFormat::Jpeg | image::ImageFormat::Png | image::ImageFormat::WebP
        ) {
            return Err(AppError::bad("仅支持 JPEG、PNG 和 WebP 图片"));
        }
        let (w, h) = image::ImageReader::with_format(Cursor::new(&bytes), format)
            .into_dimensions()
            .map_err(|_| AppError::bad("图片已损坏"))?;
        if w == 0 || h == 0 || u64::from(w) * u64::from(h) > 25_000_000 {
            return Err(AppError::bad("图片最多支持 2500 万像素，请缩小后上传"));
        }
        let mut decoder = image::ImageReader::with_format(Cursor::new(&bytes), format)
            .into_decoder()
            .map_err(|_| AppError::bad("图片无法完整读取"))?;
        let orientation = decoder
            .orientation()
            .map_err(|_| AppError::bad("无法读取照片方向"))?;
        let mut decoded = image::DynamicImage::from_decoder(decoder)
            .map_err(|_| AppError::bad("图片无法完整读取"))?;
        decoded.apply_orientation(orientation);
        const MAX_EDGE: u32 = 1280;
        const TARGET_BYTES: usize = 300 * 1024;
        // Browser-compressed WebP is fully decoded/validated but not encoded a
        // second time, avoiding extra latency and repeated lossy compression.
        let bytes = if format == image::ImageFormat::WebP
            && w.max(h) <= MAX_EDGE
            && bytes.len() <= TARGET_BYTES
            && orientation == image::metadata::Orientation::NoTransforms
        {
            bytes
        } else {
            if decoded.width().max(decoded.height()) > MAX_EDGE {
                decoded = decoded.resize(MAX_EDGE, MAX_EDGE, image::imageops::FilterType::Triangle);
            }
            loop {
                let rgba = decoded.to_rgba8();
                let optimized =
                    webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height())
                        .encode_simple(false, 60.0)
                        .map_err(|_| AppError::bad("照片压缩失败"))?
                        .to_vec();
                let edge = decoded.width().max(decoded.height());
                if optimized.len() <= TARGET_BYTES || edge <= 320 {
                    break optimized;
                }
                let next = (edge * 4 / 5).max(320);
                decoded = decoded.resize(next, next, image::imageops::FilterType::Triangle);
            }
        };
        let digest = format!("{:x}", Md5::digest(&bytes));
        Ok(Upload {
            bytes,
            mime: "image/webp",
            ext: "webp",
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
        sqlx::query_as("SELECT id,path FROM images WHERE md5=? AND size=?")
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

#[derive(serde::Deserialize)]
pub struct MediaQuery {
    v: Option<String>,
}

pub async fn serve(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<MediaQuery>,
    headers: HeaderMap,
) -> Result<Response> {
    crate::models::valid_id(&id)?;
    // Serialize open/read with deletion so a successful lookup cannot race unlink.
    let _lock = s.writes.lock().await;
    let row: (String, String, String) = sqlx::query_as("SELECT path,mime,md5 FROM images WHERE id=? AND EXISTS (SELECT 1 FROM post_images WHERE image_id=images.id)")
        .bind(id).fetch_optional(&s.db).await?.ok_or_else(AppError::missing)?;
    let (path, mime, digest) = row;
    let mut file = tokio::fs::File::open(s.data_dir.join(path))
        .await
        .map_err(|_| AppError::missing())?;
    let etag = format!("\"{digest}\"");
    let policy = if query.v.as_deref() == Some(digest.as_str()) {
        cache::IMMUTABLE
    } else {
        "public, no-cache"
    };
    if cache::matches(&headers, &etag) {
        return Ok(cache::with_headers(
            StatusCode::NOT_MODIFIED.into_response(),
            &etag,
            policy,
        ));
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).await?;
    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        "content-type",
        HeaderValue::from_str(&mime).map_err(|_| AppError::missing())?,
    );
    Ok(cache::with_headers(response, &etag, policy))
}

pub async fn cleanup(s: &AppState) -> Result<()> {
    let _lock = s.writes.lock().await;
    cleanup_locked(s).await
}
pub async fn cleanup_locked(s: &AppState) -> Result<()> {
    sqlx::query("DELETE FROM photo_uploads WHERE expires_at<=?")
        .bind(now())
        .execute(&s.db)
        .await?;
    sqlx::query("UPDATE images SET pending_delete=1 WHERE NOT EXISTS (SELECT 1 FROM post_images WHERE image_id=images.id) AND NOT EXISTS (SELECT 1 FROM photo_uploads WHERE image_id=images.id AND post_id IS NULL)").execute(&s.db).await?;
    let rows: Vec<ImageRow> = sqlx::query_as("SELECT id,path FROM images WHERE pending_delete=1 AND NOT EXISTS (SELECT 1 FROM post_images WHERE image_id=images.id) AND NOT EXISTS (SELECT 1 FROM photo_uploads WHERE image_id=images.id AND post_id IS NULL)").fetch_all(&s.db).await?;
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
