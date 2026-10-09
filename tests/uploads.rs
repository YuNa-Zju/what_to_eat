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
use what_to_eat::{AppState, init, media, router};

const OWNER: &str = "wte_visitor=11111111-1111-4111-8111-111111111111";
const OTHER: &str = "wte_visitor=22222222-2222-4222-8222-222222222222";
async fn setup() -> (tempfile::TempDir, AppState, Router, String) {
    let dir = tempfile::tempdir().unwrap();
    let state = init(dir.path(), false).await.unwrap();
    let restaurant: String = sqlx::query_scalar("SELECT id FROM restaurants LIMIT 1")
        .fetch_one(&state.db)
        .await
        .unwrap();
    let app = router(state.clone(), dir.path().join("public"));
    (dir, state, app, restaurant)
}
fn photo(color: u8) -> Vec<u8> {
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        64,
        48,
        image::Rgba([color, 100, 20, 80]),
    ))
    .write_to(&mut bytes, image::ImageFormat::Png)
    .unwrap();
    bytes.into_inner()
}
async fn send(
    app: &Router,
    method: &str,
    path: &str,
    content_type: &str,
    body: Vec<u8>,
    actor: &str,
) -> Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("cookie", actor)
                .header("content-type", content_type)
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap()
}
async fn value(response: Response) -> Value {
    serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
}
async fn stage(app: &Router, id: &str, color: u8) -> Response {
    send(
        app,
        "PUT",
        &format!("/api/uploads/{id}"),
        "image/png",
        photo(color),
        OWNER,
    )
    .await
}
fn payload(restaurant: &str, uploads: &[String]) -> Value {
    json!({"id":Uuid::new_v4().to_string(), "restaurant_id":restaurant,"eaten_on":"2026-10-09", "nickname":"", "body":"", "record_meal":true, "upload_ids": uploads})
}
async fn create(app: &Router, payload: &Value, actor: &str) -> Response {
    let body = format!(
        "--upload-test\r\nContent-Disposition: form-data; name=\"payload\"\r\n\r\n{payload}\r\n--upload-test--\r\n"
    );
    send(
        app,
        "POST",
        "/api/posts",
        "multipart/form-data; boundary=upload-test",
        body.into_bytes(),
        actor,
    )
    .await
}
async fn edit(app: &Router, post: &str, payload: &Value) -> Response {
    send(
        app,
        "PUT",
        &format!("/api/posts/{post}"),
        "application/json",
        payload.to_string().into_bytes(),
        OWNER,
    )
    .await
}
async fn count(state: &AppState, table: &str) -> i64 {
    sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
        .fetch_one(&state.db)
        .await
        .unwrap()
}
async fn image_path(state: &AppState, upload: &str) -> (String, String) {
    sqlx::query_as(
        "SELECT i.id,i.path FROM images i JOIN photo_uploads u ON u.image_id=i.id WHERE u.id=?",
    )
    .bind(upload)
    .fetch_one(&state.db)
    .await
    .unwrap()
}

#[tokio::test]
async fn uploads_are_private_owned_idempotent_and_publish_atomically() {
    let (_dir, state, app, restaurant) = setup().await;
    let id = Uuid::new_v4().to_string();
    let result = stage(&app, &id, 80).await;
    assert_eq!(result.status(), StatusCode::OK);
    assert_eq!(result.headers()["cache-control"], "no-store");
    let receipt = value(result).await;
    assert_eq!(receipt["id"], id);
    assert!(receipt["expires_at"].as_i64().unwrap() > what_to_eat::models::now());
    assert_eq!(stage(&app, &id, 80).await.status(), StatusCode::OK);
    assert_eq!(count(&state, "images").await, 1);
    assert_eq!(count(&state, "posts").await, 0);
    assert_eq!(count(&state, "meals").await, 0);
    let (image, path) = image_path(&state, &id).await;
    assert!(path.ends_with(".webp"));
    assert_eq!(
        send(&app, "GET", &format!("/media/{image}"), "", vec![], OWNER)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    media::cleanup(&state).await.unwrap();
    assert!(state.data_dir.join(&path).exists());
    assert_eq!(
        send(
            &app,
            "PUT",
            &format!("/api/uploads/{id}"),
            "image/png",
            photo(80),
            OTHER
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
    send(
        &app,
        "DELETE",
        &format!("/api/uploads/{id}"),
        "",
        vec![],
        OTHER,
    )
    .await;
    assert_eq!(count(&state, "photo_uploads").await, 1);
    let input = payload(&restaurant, std::slice::from_ref(&id));
    assert_eq!(
        create(&app, &input, OTHER).await.status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(count(&state, "posts").await, 0);
    assert_eq!(count(&state, "meals").await, 0);
    let published = create(&app, &input, OWNER).await;
    assert_eq!(published.status(), StatusCode::OK);
    let post = value(published).await;
    assert_eq!(post["images"][0]["id"], image);
    let url = post["images"][0]["url"].as_str().unwrap();
    let response = send(&app, "GET", url, "", vec![], OWNER).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "image/webp");
    assert_eq!(
        response.headers()["cache-control"],
        "public, max-age=31536000, immutable"
    );
    assert_eq!(create(&app, &input, OWNER).await.status(), StatusCode::OK);
    assert_eq!(count(&state, "meals").await, 1);
    assert_eq!(
        create(
            &app,
            &payload(&restaurant, std::slice::from_ref(&id)),
            OWNER
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(count(&state, "posts").await, 1);
    assert_eq!(count(&state, "meals").await, 1);
    // Closing the composer discards its receipt, not the published image.
    assert_eq!(
        send(
            &app,
            "DELETE",
            &format!("/api/uploads/{id}"),
            "",
            vec![],
            OWNER
        )
        .await
        .status(),
        StatusCode::NO_CONTENT
    );
    assert!(state.data_dir.join(&path).exists());
    assert_eq!(count(&state, "photo_uploads").await, 0);
    assert_eq!(create(&app, &input, OWNER).await.status(), StatusCode::OK);
    send(
        &app,
        "DELETE",
        &format!("/api/posts/{}", input["id"].as_str().unwrap()),
        "",
        vec![],
        OWNER,
    )
    .await;
    assert!(!state.data_dir.join(path).exists());
}

#[tokio::test]
async fn deduplication_cleanup_expiry_and_restart_preserve_active_uploads() {
    let (dir, state, app, restaurant) = setup().await;
    let a = Uuid::new_v4().to_string();
    let b = Uuid::new_v4().to_string();
    let (first, second) = tokio::join!(stage(&app, &a, 120), stage(&app, &b, 120));
    assert_eq!(first.status(), StatusCode::OK);
    assert_eq!(second.status(), StatusCode::OK);
    assert_eq!(count(&state, "images").await, 1);
    let (_, path) = image_path(&state, &a).await;
    let reopened = init(dir.path(), false).await.unwrap();
    media::cleanup(&reopened).await.unwrap();
    assert!(state.data_dir.join(&path).exists());
    let input = payload(&restaurant, std::slice::from_ref(&a));
    assert_eq!(create(&app, &input, OWNER).await.status(), StatusCode::OK);
    send(
        &app,
        "DELETE",
        &format!("/api/posts/{}", input["id"].as_str().unwrap()),
        "",
        vec![],
        OWNER,
    )
    .await;
    assert!(
        state.data_dir.join(&path).exists(),
        "second pending upload protects deduplicated image"
    );
    sqlx::query("UPDATE photo_uploads SET expires_at=0")
        .execute(&state.db)
        .await
        .unwrap();
    assert_eq!(
        create(&app, &payload(&restaurant, std::slice::from_ref(&b)), OWNER)
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(count(&state, "posts").await, 0);
    media::cleanup(&state).await.unwrap();
    assert!(!state.data_dir.join(&path).exists());
    assert_eq!(count(&state, "photo_uploads").await, 0);
    assert_eq!(count(&state, "images").await, 0);
    // Re-uploading the expired ID renews the draft without losing its image.
    assert_eq!(stage(&app, &b, 120).await.status(), StatusCode::OK);
    assert_eq!(
        create(&app, &payload(&restaurant, &[b]), OWNER)
            .await
            .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn edit_retries_keep_order_and_invalid_uploads_do_not_remove_photos() {
    let (_dir, state, app, restaurant) = setup().await;
    let a = Uuid::new_v4().to_string();
    let b = Uuid::new_v4().to_string();
    stage(&app, &a, 40).await;
    stage(&app, &b, 180).await;
    let input = payload(&restaurant, std::slice::from_ref(&a));
    let post = value(create(&app, &input, OWNER).await).await;
    let id = post["id"].as_str().unwrap();
    let original = post["images"][0]["id"].as_str().unwrap();
    let (new_image, new_path) = image_path(&state, &b).await;
    let change = json!({"nickname":"","body":"","keep_image_ids":[original],"upload_ids":[b]});
    for _ in 0..2 {
        assert_eq!(
            edit(&app, id, &change).await.status(),
            StatusCode::NO_CONTENT
        );
        let images: Vec<String> = sqlx::query_scalar(
            "SELECT image_id FROM post_images WHERE post_id=? ORDER BY position",
        )
        .bind(id)
        .fetch_all(&state.db)
        .await
        .unwrap();
        assert_eq!(images, vec![original.to_string(), new_image.clone()]);
    }
    let invalid = json!({"nickname":"","body":"changed","keep_image_ids":[],"upload_ids":[Uuid::new_v4().to_string()]});
    assert_eq!(
        edit(&app, id, &invalid).await.status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(count(&state, "post_images").await, 2);
    let body: String = sqlx::query_scalar("SELECT body FROM posts WHERE id=?")
        .bind(id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(body, "");
    let change = json!({"nickname":"","body":"","keep_image_ids":[original],"upload_ids":[]});
    assert_eq!(
        edit(&app, id, &change).await.status(),
        StatusCode::NO_CONTENT
    );
    assert!(
        !state.data_dir.join(new_path).exists(),
        "claimed receipt does not pin a removed photo"
    );
    assert_eq!(count(&state, "post_images").await, 1);
}

#[tokio::test]
async fn upload_validation_limits_and_cross_origin_checks_leave_no_files() {
    let (_dir, state, app, restaurant) = setup().await;
    let id = Uuid::new_v4().to_string();
    for body in [vec![], b"not a picture".to_vec()] {
        assert_eq!(
            send(
                &app,
                "PUT",
                &format!("/api/uploads/{id}"),
                "image/webp",
                body,
                OWNER
            )
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(
        send(
            &app,
            "PUT",
            &format!("/api/uploads/{id}"),
            "image/png",
            vec![0; 10 * 1024 * 1024 + 1],
            OWNER
        )
        .await
        .status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/uploads/{id}"))
                .header("origin", "https://elsewhere.example")
                .header("host", "food.example")
                .body(Body::from(photo(80)))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(count(&state, "images").await, 0);
    assert_eq!(count(&state, "photo_uploads").await, 0);
    let too_many: Vec<String> = (0..7).map(|_| Uuid::new_v4().to_string()).collect();
    assert_eq!(
        create(&app, &payload(&restaurant, &too_many), OWNER)
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        create(&app, &payload(&restaurant, &[id.clone(), id]), OWNER)
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(count(&state, "posts").await, 0);
    assert_eq!(count(&state, "meals").await, 0);
}
