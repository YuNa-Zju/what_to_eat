use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
    response::Response,
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;
use what_to_eat::{AppState, init, router};

async fn setup() -> (tempfile::TempDir, AppState, Router) {
    let dir = tempfile::tempdir().unwrap();
    let state = init(dir.path(), false).await.unwrap();
    let public = dir.path().join("public");
    std::fs::create_dir_all(public.join("assets")).unwrap();
    std::fs::write(public.join("index.html"), "<!doctype html><h1>test</h1>").unwrap();
    std::fs::write(
        public.join("assets/index-Ab12cd34.js"),
        "console.log('v1');",
    )
    .unwrap();
    std::fs::write(public.join("assets/index-Ab12cd34.css"), "body{color:red}").unwrap();
    std::fs::write(
        public.join("assets/unversioned.js"),
        "console.log('mutable');",
    )
    .unwrap();
    let app = router(state.clone(), public);
    (dir, state, app)
}
async fn get(app: &Router, path: &str, tag: Option<&str>) -> Response {
    let mut req = Request::builder().uri(path);
    if let Some(tag) = tag {
        req = req.header("if-none-match", tag);
    }
    app.clone()
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap()
}
async fn bytes(response: Response) -> Vec<u8> {
    response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec()
}
async fn write(app: &Router, method: &str, path: &str, body: Value) -> Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn restaurant_cache_revalidates_and_changes_after_edits() {
    let (_dir, _state, app) = setup().await;
    let response = get(&app, "/api/restaurants", None).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "private, no-cache");
    let tag = response.headers()["etag"].to_str().unwrap().to_owned();
    let restaurants: Value = serde_json::from_slice(&bytes(response).await).unwrap();
    assert_eq!(restaurants.as_array().unwrap().len(), 30);
    for validator in [
        tag.clone(),
        format!("W/{tag}"),
        format!("\"unrelated\", W/{tag}"),
        "*".into(),
    ] {
        let cached = get(&app, "/api/restaurants", Some(&validator)).await;
        assert_eq!(cached.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(cached.headers()["etag"], tag);
        assert_eq!(cached.headers()["cache-control"], "private, no-cache");
        assert!(bytes(cached).await.is_empty());
    }
    assert_eq!(
        get(&app, "/api/restaurants", Some("\"unrelated\""))
            .await
            .status(),
        StatusCode::OK
    );
    let first_id = restaurants[0]["id"].as_str().unwrap();
    let edited = write(
        &app,
        "PUT",
        &format!("/api/restaurants/{first_id}"),
        json!({"name":"缓存测试改名", "active":false}),
    )
    .await;
    assert_eq!(edited.status(), StatusCode::NO_CONTENT);
    assert_eq!(edited.headers()["cache-control"], "no-store");
    let changed = get(&app, "/api/restaurants", Some(&tag)).await;
    assert_eq!(changed.status(), StatusCode::OK);
    let changed_tag = changed.headers()["etag"].to_str().unwrap().to_owned();
    assert_ne!(changed_tag, tag);
    let rows: Value = serde_json::from_slice(&bytes(changed).await).unwrap();
    assert_eq!(rows[0]["name"], "缓存测试改名");
    assert_eq!(rows[0]["active"], false);
    let head = app
        .clone()
        .oneshot(
            Request::builder()
                .method("HEAD")
                .uri("/api/restaurants")
                .header("if-none-match", &changed_tag)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(head.status(), StatusCode::NOT_MODIFIED);
    assert!(bytes(head).await.is_empty());
    let created = write(
        &app,
        "POST",
        "/api/restaurants",
        json!({"name":"缓存测试新店", "active":true}),
    )
    .await;
    assert_eq!(created.status(), StatusCode::OK);
    assert_eq!(created.headers()["cache-control"], "no-store");
    let after_add = get(&app, "/api/restaurants", Some(&changed_tag)).await;
    assert_eq!(after_add.status(), StatusCode::OK);
    assert_ne!(after_add.headers()["etag"], changed_tag);
    for path in [
        "/api/health",
        "/api/meals",
        "/api/settings",
        "/api/posts",
        "/api/missing",
    ] {
        assert_eq!(
            get(&app, path, None).await.headers()["cache-control"],
            "no-store"
        );
    }
}

async fn image_fixture(state: &AppState) -> (String, String) {
    let restaurant: String = sqlx::query_scalar("SELECT id FROM restaurants LIMIT 1")
        .fetch_one(&state.db)
        .await
        .unwrap();
    let post = Uuid::new_v4().to_string();
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(2, 2)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let upload = what_to_eat::media::validate(png.into_inner())
        .await
        .unwrap();
    let mut tx = state.db.begin().await.unwrap();
    sqlx::query("INSERT INTO posts(id,restaurant_id,eaten_on,nickname,body,created_at) VALUES (?,?,'2026-10-09','','cache test',1)")
        .bind(&post).bind(&restaurant).execute(&mut *tx).await.unwrap();
    let image = what_to_eat::media::store(state, &mut tx, &upload, &mut Vec::new())
        .await
        .unwrap();
    sqlx::query("INSERT INTO post_images VALUES(?,?,0)")
        .bind(&post)
        .bind(&image)
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    (post, image)
}
async fn image_url(app: &Router) -> String {
    let posts: Value =
        serde_json::from_slice(&bytes(get(app, "/api/posts", None).await).await).unwrap();
    posts[0]["images"][0]["url"].as_str().unwrap().to_owned()
}

#[tokio::test]
async fn image_cache_versions_content_and_revalidates_legacy_urls() {
    use md5::{Digest, Md5};
    let (_dir, state, app) = setup().await;
    let (post, image) = image_fixture(&state).await;
    let versioned_url = image_url(&app).await;
    assert!(versioned_url.starts_with(&format!("/media/{image}?v=")));
    let response = get(&app, &versioned_url, None).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()["cache-control"],
        "public, max-age=31536000, immutable"
    );
    let tag = response.headers()["etag"].to_str().unwrap().to_owned();
    let original_bytes = bytes(response).await;
    let cached = get(&app, &versioned_url, Some(&format!("W/{tag}"))).await;
    assert_eq!(cached.status(), StatusCode::NOT_MODIFIED);
    assert_eq!(cached.headers()["etag"], tag);
    assert!(bytes(cached).await.is_empty());
    let legacy = format!("/media/{image}");
    assert_eq!(
        get(&app, &legacy, None).await.headers()["cache-control"],
        "public, no-cache"
    );
    assert_eq!(
        get(&app, &legacy, Some(&tag)).await.status(),
        StatusCode::NOT_MODIFIED
    );
    let mismatch = get(&app, &format!("{legacy}?v=old"), None).await;
    assert_eq!(mismatch.headers()["cache-control"], "public, no-cache");
    assert_eq!(bytes(mismatch).await, original_bytes);
    let head = app
        .clone()
        .oneshot(
            Request::builder()
                .method("HEAD")
                .uri(&versioned_url)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(head.status(), StatusCode::OK);
    assert_eq!(head.headers()["etag"], tag);
    assert!(bytes(head).await.is_empty());

    // Same-ID maintenance (such as recompression) must issue a new version URL.
    let relative: String = sqlx::query_scalar("SELECT path FROM images WHERE id=?")
        .bind(&image)
        .fetch_one(&state.db)
        .await
        .unwrap();
    let mut new_png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(3, 3)
        .write_to(&mut new_png, image::ImageFormat::Png)
        .unwrap();
    let new_bytes = new_png.into_inner();
    let digest = format!("{:x}", Md5::digest(&new_bytes));
    tokio::fs::write(state.data_dir.join(&relative), &new_bytes)
        .await
        .unwrap();
    sqlx::query("UPDATE images SET md5=?,size=? WHERE id=?")
        .bind(&digest)
        .bind(new_bytes.len() as i64)
        .bind(&image)
        .execute(&state.db)
        .await
        .unwrap();
    let next_url = image_url(&app).await;
    assert_ne!(next_url, versioned_url);
    assert!(next_url.ends_with(&digest));
    let old_url = get(&app, &versioned_url, Some(&tag)).await;
    assert_eq!(old_url.status(), StatusCode::OK);
    assert_eq!(old_url.headers()["cache-control"], "public, no-cache");
    assert_ne!(old_url.headers()["etag"], tag);
    assert_eq!(bytes(old_url).await, new_bytes);
    assert_eq!(
        get(&app, &next_url, None).await.headers()["cache-control"],
        "public, max-age=31536000, immutable"
    );
    assert_eq!(
        write(&app, "DELETE", &format!("/api/posts/{post}"), Value::Null)
            .await
            .status(),
        StatusCode::NO_CONTENT
    );
    let deleted = get(&app, &next_url, Some("*")).await;
    assert_eq!(deleted.status(), StatusCode::NOT_FOUND);
    assert_eq!(deleted.headers()["cache-control"], "no-store");
}

#[tokio::test]
async fn static_cache_keeps_html_fresh_and_only_immutable_for_versioned_assets() {
    let (_dir, _state, app) = setup().await;
    for path in ["/assets/index-Ab12cd34.js", "/assets/index-Ab12cd34.css"] {
        let response = get(&app, path, None).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()["cache-control"],
            "public, max-age=31536000, immutable"
        );
        let modified = response.headers()["last-modified"].clone();
        let conditional = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(path)
                    .header("if-modified-since", modified)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(conditional.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(
            conditional.headers()["cache-control"],
            "public, max-age=31536000, immutable"
        );
    }
    for path in ["/", "/index.html", "/assets/unversioned.js"] {
        let response = get(&app, path, None).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["cache-control"], "no-cache");
    }
    for path in ["/assets/missing-Ab12cd34.js", "/history"] {
        let missing = get(&app, path, None).await;
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
        assert_eq!(missing.headers()["cache-control"], "no-store");
    }
}
