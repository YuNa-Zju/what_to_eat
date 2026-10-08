use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;
use what_to_eat::{AppState, init, router};

async fn setup() -> (tempfile::TempDir, AppState, Router, String) {
    let directory = tempfile::tempdir().unwrap();
    let state = init(directory.path(), false).await.unwrap();
    let restaurant: String = sqlx::query_scalar("SELECT id FROM restaurants LIMIT 1")
        .fetch_one(&state.db)
        .await
        .unwrap();
    let app = router(state.clone(), directory.path().join("public"));
    (directory, state, app, restaurant)
}
async fn request(
    app: &Router,
    method: &str,
    path: &str,
    body: Value,
    cookie: Option<&str>,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if let Some(cookie) = cookie {
        request = request.header("cookie", cookie);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
fn png() -> Vec<u8> {
    let mut buffer = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(2, 2)
        .write_to(&mut buffer, image::ImageFormat::Png)
        .unwrap();
    buffer.into_inner()
}
async fn upload(app: &Router, payload: Value, photos: &[Vec<u8>]) -> (StatusCode, Value) {
    upload_to(app, "POST", "/api/posts", payload, photos).await
}
async fn upload_to(
    app: &Router,
    method: &str,
    path: &str,
    payload: Value,
    photos: &[Vec<u8>],
) -> (StatusCode, Value) {
    let boundary = "test-meal-boundary";
    let mut bytes = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"payload\"\r\n\r\n{payload}\r\n"
    )
    .into_bytes();
    for photo in photos {
        bytes.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"photos\"; filename=\"meal.png\"\r\nContent-Type: image/png\r\n\r\n").as_bytes());
        bytes.extend_from_slice(photo);
        bytes.extend_from_slice(b"\r\n");
    }
    bytes.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header(
                    "content-type",
                    format!("multipart/form-data; boundary={boundary}"),
                )
                .body(Body::from(bytes))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let value = serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
        .unwrap_or(Value::Null);
    (status, value)
}
fn payload(restaurant: &str, record: bool) -> Value {
    json!({"id":Uuid::new_v4().to_string(),"restaurant_id":restaurant,"eaten_on":"2026-10-08","nickname":"","body":"## 今天不错\n\n- 牛肉很好吃","record_meal":record})
}

#[tokio::test]
async fn ratings_roundtrip_and_share_uses_the_same_rating() {
    let (_dir, state, app, restaurant) = setup().await;
    let id = Uuid::new_v4().to_string();
    let mut meal = json!({"id":id,"restaurant_id":restaurant,"eaten_on":"2026-10-08","rating":-1});
    let created = request(&app, "POST", "/api/meals", meal.clone(), None).await;
    assert_eq!(created.0, StatusCode::OK);
    assert_eq!(created.1["rating"], -1);
    meal["rating"] = json!(1);
    assert_eq!(
        request(&app, "PUT", &format!("/api/meals/{id}"), meal.clone(), None)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    let rows = request(&app, "GET", "/api/meals", Value::Null, None)
        .await
        .1;
    assert_eq!(rows[0]["rating"], 1);
    meal["rating"] = json!(2);
    assert_eq!(
        request(&app, "PUT", &format!("/api/meals/{id}"), meal, None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    let mut post = payload(&restaurant, true);
    post["meal_rating"] = json!(0);
    let created = upload(&app, post, &[]).await;
    assert_eq!(created.0, StatusCode::OK);
    let rating: Option<i64> = sqlx::query_scalar("SELECT rating FROM meals WHERE id=?")
        .bind(created.1["shared_meal_id"].as_str().unwrap())
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(rating, Some(0));
}

#[tokio::test]
async fn upgrading_existing_history_preserves_records_and_defaults_to_unrated() {
    use sqlx::{SqlitePool, sqlite::SqliteConnectOptions};
    let dir = tempfile::tempdir().unwrap();
    let legacy = dir.path().join("legacy-migrations");
    std::fs::create_dir(&legacy).unwrap();
    std::fs::write(
        legacy.join("0001_initial.sql"),
        include_str!("../migrations/0001_initial.sql"),
    )
    .unwrap();
    let db = SqlitePool::connect_with(
        SqliteConnectOptions::new()
            .filename(dir.path().join("app.sqlite"))
            .create_if_missing(true),
    )
    .await
    .unwrap();
    sqlx::migrate::Migrator::new(legacy.as_path())
        .await
        .unwrap()
        .run(&db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO restaurants VALUES ('legacy','老店',1,1)")
        .execute(&db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO meals VALUES ('old-meal','legacy','2026-10-07',1)")
        .execute(&db)
        .await
        .unwrap();
    db.close().await;
    let upgraded = init(dir.path(), false).await.unwrap();
    let row: (String, Option<i64>) =
        sqlx::query_as("SELECT restaurant_id,rating FROM meals WHERE id='old-meal'")
            .fetch_one(&upgraded.db)
            .await
            .unwrap();
    assert_eq!(row, ("legacy".into(), None));
}

#[tokio::test]
async fn initialization_and_history_are_persistent_and_idempotent() {
    let (dir, state, app, restaurant) = setup().await;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM restaurants")
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(count, 30);
    let meal =
        json!({"id":Uuid::new_v4().to_string(),"restaurant_id":restaurant,"eaten_on":"2026-10-08"});
    assert_eq!(
        request(&app, "POST", "/api/meals", meal.clone(), None)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        request(&app, "POST", "/api/meals", meal.clone(), None)
            .await
            .0,
        StatusCode::OK
    );
    let rows = request(&app, "GET", "/api/meals", Value::Null, None)
        .await
        .1;
    assert_eq!(rows.as_array().unwrap().len(), 1);
    request(&app, "PUT", "/api/settings", json!({"window_size":7}), None).await;
    let reopened = init(dir.path(), false).await.unwrap();
    let size: i64 = sqlx::query_scalar("SELECT window_size FROM settings")
        .fetch_one(&reopened.db)
        .await
        .unwrap();
    assert_eq!(size, 7);
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM restaurants")
        .fetch_one(&reopened.db)
        .await
        .unwrap();
    assert_eq!(count, 30);
    assert_eq!(
        request(&app, "PUT", "/api/settings", json!({"window_size":0}), None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn shared_photo_survives_until_last_reference_and_post_retry_is_atomic() {
    let (_dir, state, app, restaurant) = setup().await;
    let first = payload(&restaurant, true);
    let second = payload(&restaurant, false);
    let photo = png();
    let first_photos = [photo.clone()];
    let second_photos = [photo.clone()];
    let (a, b) = tokio::join!(
        upload(&app, first.clone(), &first_photos),
        upload(&app, second.clone(), &second_photos)
    );
    assert_eq!(a.0, StatusCode::OK);
    assert_eq!(b.0, StatusCode::OK);
    assert_eq!(a.1["images"][0]["id"], b.1["images"][0]["id"]);
    let retry = upload(&app, first.clone(), &[photo]).await;
    assert_eq!(retry.1["id"], first["id"]);
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meals")
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(count, 1);
    let path: String = sqlx::query_scalar("SELECT path FROM images")
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert!(state.data_dir.join(&path).exists());
    request(
        &app,
        "DELETE",
        &format!("/api/posts/{}", first["id"].as_str().unwrap()),
        Value::Null,
        None,
    )
    .await;
    assert!(state.data_dir.join(&path).exists());
    request(
        &app,
        "DELETE",
        &format!("/api/posts/{}", second["id"].as_str().unwrap()),
        Value::Null,
        None,
    )
    .await;
    assert!(!state.data_dir.join(path).exists());
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meals")
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(count, 1, "deleting a post must not delete its meal");
}

#[tokio::test]
async fn votes_switch_and_cancel_without_accumulating() {
    let (_dir, _state, app, restaurant) = setup().await;
    let post = upload(&app, payload(&restaurant, false), &[]).await.1;
    let cookie = format!("wte_visitor={}", Uuid::new_v4());
    let route = format!("/api/posts/{}/vote", post["id"].as_str().unwrap());
    let up = request(&app, "POST", &route, json!({"value":1}), Some(&cookie))
        .await
        .1;
    assert_eq!(up["likes"], 1);
    let down = request(&app, "POST", &route, json!({"value":-1}), Some(&cookie))
        .await
        .1;
    assert_eq!(down["likes"], 0);
    assert_eq!(down["dislikes"], 1);
    let clear = request(&app, "POST", &route, json!({"value":0}), Some(&cookie))
        .await
        .1;
    assert_eq!(clear["likes"], 0);
    assert_eq!(clear["dislikes"], 0);
}

#[tokio::test]
async fn invalid_photo_cannot_leave_a_post_or_meal() {
    let (_dir, state, app, restaurant) = setup().await;
    assert_eq!(
        upload(
            &app,
            payload(&restaurant, true),
            &[b"not an image".to_vec()]
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    for table in ["posts", "images", "meals"] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
}

#[tokio::test]
async fn retired_restaurants_leave_history_intact_and_cross_site_writes_fail() {
    let (_dir, _state, app, restaurant) = setup().await;
    let meal =
        json!({"id":Uuid::new_v4().to_string(),"restaurant_id":restaurant,"eaten_on":"2026-10-08"});
    request(&app, "POST", "/api/meals", meal, None).await;
    request(
        &app,
        "PUT",
        &format!("/api/restaurants/{restaurant}"),
        json!({"name":"归档饭店","active":false}),
        None,
    )
    .await;
    let rows = request(&app, "GET", "/api/meals", Value::Null, None)
        .await
        .1;
    assert_eq!(rows.as_array().unwrap().len(), 1);
    let response = app
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/settings")
                .header("host", "food.example.com")
                .header("origin", "https://elsewhere.example")
                .header("content-type", "application/json")
                .body(Body::from("{\"window_size\":3}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn post_filters_apply_before_pagination_and_sort_stably() {
    let (_dir, state, app, restaurant) = setup().await;
    let other: String = sqlx::query_scalar("SELECT id FROM restaurants WHERE id!=? LIMIT 1")
        .bind(&restaurant)
        .fetch_one(&state.db)
        .await
        .unwrap();
    sqlx::query("UPDATE restaurants SET name='SearchCafe' WHERE id=?")
        .bind(&restaurant)
        .execute(&state.db)
        .await
        .unwrap();
    let meal = Uuid::new_v4().to_string();
    let mut ids = Vec::new();
    for i in 0..25 {
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO posts(id,restaurant_id,eaten_on,nickname,body,shared_meal_id,created_at) VALUES(?,?,?,?,?,?,?)")
            .bind(&id).bind(if i < 23 { &restaurant } else { &other }).bind(if i == 0 { "2026-10-09" } else { "2026-10-08" })
            .bind(if i < 23 { "alice" } else { "" }).bind(if i == 0 { "100% noodle_ liked" } else { "noodles" })
            .bind(if i < 3 { Some(&meal) } else { None }).bind(i).execute(&state.db).await.unwrap();
        ids.push(id);
    }
    let first = request(
        &app,
        "GET",
        &format!("/api/posts?restaurant_id={restaurant}&nickname=alice&sort=oldest"),
        Value::Null,
        None,
    )
    .await;
    assert_eq!(first.0, StatusCode::OK);
    assert_eq!(first.1.as_array().unwrap().len(), 20);
    assert_eq!(first.1[0]["id"], ids[0]);
    let next = request(
        &app,
        "GET",
        &format!("/api/posts?restaurant_id={restaurant}&nickname=alice&sort=oldest&offset=20"),
        Value::Null,
        None,
    )
    .await
    .1;
    assert_eq!(next.as_array().unwrap().len(), 3);
    assert_eq!(next[0]["id"], ids[20]);
    let linked = request(
        &app,
        "GET",
        &format!("/api/posts?meal_id={meal}"),
        Value::Null,
        None,
    )
    .await
    .1;
    assert_eq!(linked.as_array().unwrap().len(), 3);
    let anon = request(&app, "GET", "/api/posts?nickname=", Value::Null, None)
        .await
        .1;
    assert_eq!(anon.as_array().unwrap().len(), 2);
    for query in [
        "q=%25",
        "q=noodle_",
        "q=SearchCafe%20liked",
        "start=2026-10-09&end=2026-10-09",
    ] {
        let result = request(
            &app,
            "GET",
            &format!("/api/posts?{query}"),
            Value::Null,
            None,
        )
        .await;
        assert_eq!(result.0, StatusCode::OK);
        assert_eq!(result.1.as_array().unwrap().len(), 1);
        assert_eq!(result.1[0]["id"], ids[0]);
    }
    let authors = request(&app, "GET", "/api/posts/authors", Value::Null, None)
        .await
        .1;
    assert_eq!(authors[0]["nickname"], "alice");
    assert_eq!(authors[0]["count"], 23);
    request(
        &app,
        "POST",
        &format!("/api/posts/{}/vote", ids[0]),
        json!({"value":1}),
        Some("wte_visitor=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    )
    .await;
    for sort in ["liked", "eaten"] {
        let result = request(
            &app,
            "GET",
            &format!("/api/posts?sort={sort}"),
            Value::Null,
            None,
        )
        .await
        .1;
        assert_eq!(result[0]["id"], ids[0]);
    }
    let selected = request(
        &app,
        "GET",
        &format!("/api/posts?ids={},{}", ids[0], ids[24]),
        Value::Null,
        None,
    )
    .await
    .1;
    assert_eq!(selected.as_array().unwrap().len(), 2);
    assert_eq!(
        request(&app, "GET", "/api/posts?ids=", Value::Null, None)
            .await
            .1
            .as_array()
            .unwrap()
            .len(),
        0
    );
    let latest = request(&app, "GET", "/api/posts", Value::Null, None)
        .await
        .1;
    let last = &latest[19];
    let old_page = request(
        &app,
        "GET",
        &format!(
            "/api/posts?before={}&before_id={}&nickname=alice",
            last["created_at"],
            last["id"].as_str().unwrap()
        ),
        Value::Null,
        None,
    )
    .await
    .1;
    assert_eq!(old_page.as_array().unwrap().len(), 5);
    for query in [
        "sort=invalid",
        "offset=-1",
        "start=2026-02-30",
        "start=2026-10-09&end=2026-10-08",
        "sort=liked&before=1",
        "ids=invalid",
    ] {
        assert_eq!(
            request(
                &app,
                "GET",
                &format!("/api/posts?{query}"),
                Value::Null,
                None
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
}

#[tokio::test]
async fn photo_compression_resizes_corrects_orientation_and_is_deterministic() {
    let (_dir, state, app, restaurant) = setup().await;
    let source = image::RgbImage::from_fn(2400, 1200, |x, y| {
        image::Rgb([(x / 10) as u8, (y / 10) as u8, 80])
    });
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 100)
        .encode_image(&source)
        .unwrap();
    // EXIF orientation 6: rotate 90 degrees clockwise before resizing.
    let exif = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
    let mut original = vec![0xff, 0xd8, 0xff, 0xe1];
    original.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
    original.extend_from_slice(exif);
    original.extend_from_slice(&jpeg[2..]);
    let a = what_to_eat::media::validate(original.clone())
        .await
        .unwrap();
    let b = what_to_eat::media::validate(original.clone())
        .await
        .unwrap();
    assert_eq!(a.digest, b.digest);
    assert_eq!(a.bytes, b.bytes);
    assert_eq!(a.mime, "image/jpeg");
    assert!(a.bytes.len() < original.len());
    assert!(a.bytes.len() <= 1024 * 1024);
    let decoded = image::load_from_memory(&a.bytes).unwrap();
    assert_eq!((decoded.width(), decoded.height()), (800, 1600));
    let published = upload(&app, payload(&restaurant, false), &[original]).await;
    assert_eq!(published.0, StatusCode::OK);
    let row: (String, i64) = sqlx::query_as("SELECT path,size FROM images")
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(
        tokio::fs::read(state.data_dir.join(row.0)).await.unwrap(),
        a.bytes
    );
    assert_eq!(row.1 as usize, a.bytes.len());
}

#[tokio::test]
async fn compression_preserves_transparency_and_does_not_inflate_small_images() {
    let small = png();
    let compact = what_to_eat::media::validate(small.clone()).await.unwrap();
    assert!(compact.bytes.len() <= small.len());
    assert_eq!(
        image::load_from_memory(&compact.bytes).unwrap().to_rgba8(),
        image::load_from_memory(&small).unwrap().to_rgba8()
    );
    let source = image::RgbaImage::from_pixel(2000, 1000, image::Rgba([220, 100, 40, 80]));
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(source)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    let optimized = what_to_eat::media::validate(bytes.into_inner())
        .await
        .unwrap();
    let decoded = image::load_from_memory(&optimized.bytes)
        .unwrap()
        .to_rgba8();
    assert_eq!(decoded.dimensions(), (1600, 800));
    assert_eq!(decoded.get_pixel(0, 0)[3], 80);
    assert_eq!(optimized.mime, "image/png");
}

#[tokio::test]
async fn editing_posts_preserves_bound_fields_and_updates_independent_metadata_and_photos() {
    let (_dir, state, app, restaurant) = setup().await;
    let bound = upload(&app, payload(&restaurant, true), &[png()]).await.1;
    let independent = upload(&app, payload(&restaurant, false), &[png()]).await.1;
    let image_id = bound["images"][0]["id"].as_str().unwrap();
    let image_path: String = sqlx::query_scalar("SELECT path FROM images WHERE id=?")
        .bind(image_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    let mut edit = json!({"nickname":"edited", "body":"updated", "restaurant_id":restaurant, "eaten_on":"2026-10-09"});
    assert_eq!(
        request(
            &app,
            "PUT",
            &format!("/api/posts/{}", bound["id"].as_str().unwrap()),
            edit.clone(),
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &app,
            "PUT",
            &format!("/api/posts/{}", independent["id"].as_str().unwrap()),
            edit.clone(),
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let rows = request(
        &app,
        "GET",
        &format!("/api/posts?ids={}", independent["id"].as_str().unwrap()),
        Value::Null,
        None,
    )
    .await
    .1;
    assert_eq!(rows[0]["eaten_on"], "2026-10-09");
    assert_eq!(rows[0]["images"][0]["id"], image_id);
    edit["eaten_on"] = json!("2026-10-08");
    edit["keep_image_ids"] = json!([]);
    assert_eq!(
        upload_to(
            &app,
            "PUT",
            &format!("/api/posts/{}", bound["id"].as_str().unwrap()),
            edit.clone(),
            &[]
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert!(
        state.data_dir.join(&image_path).exists(),
        "another post still uses the image"
    );
    edit["eaten_on"] = json!("2026-10-09");
    assert_eq!(
        upload_to(
            &app,
            "PUT",
            &format!("/api/posts/{}", independent["id"].as_str().unwrap()),
            edit.clone(),
            &[]
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert!(!state.data_dir.join(&image_path).exists());
    assert_eq!(
        upload_to(
            &app,
            "PUT",
            &format!("/api/posts/{}", independent["id"].as_str().unwrap()),
            edit.clone(),
            &[png()]
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    edit["keep_image_ids"] = json!([Uuid::new_v4().to_string()]);
    assert_eq!(
        upload_to(
            &app,
            "PUT",
            &format!("/api/posts/{}", independent["id"].as_str().unwrap()),
            edit,
            &[]
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let meal_id = bound["shared_meal_id"].as_str().unwrap();
    let meal = json!({"id":meal_id,"restaurant_id":restaurant,"eaten_on":"2026-10-10","rating":1});
    assert_eq!(
        request(&app, "PUT", &format!("/api/meals/{meal_id}"), meal, None)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    let rows = request(
        &app,
        "GET",
        &format!("/api/posts?meal_id={meal_id}"),
        Value::Null,
        None,
    )
    .await
    .1;
    assert_eq!(rows[0]["eaten_on"], "2026-10-10");
    request(
        &app,
        "DELETE",
        &format!("/api/meals/{meal_id}"),
        Value::Null,
        None,
    )
    .await;
    let rows = request(
        &app,
        "GET",
        &format!("/api/posts?ids={}", bound["id"].as_str().unwrap()),
        Value::Null,
        None,
    )
    .await
    .1;
    assert!(rows[0]["shared_meal_id"].is_null());
}
