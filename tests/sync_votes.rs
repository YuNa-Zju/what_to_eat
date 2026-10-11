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

async fn call(
    app: &Router,
    method: &str,
    path: &str,
    actor: &str,
    code: Option<&str>,
    body: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json")
        .header("cookie", format!("wte_visitor={actor}"));
    if let Some(code) = code {
        request = request.header("x-sync-code", code);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    assert_eq!(response.headers()["cache-control"], "no-store");
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    if status == StatusCode::NO_CONTENT {
        assert!(bytes.is_empty());
    }
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn setup() -> (tempfile::TempDir, AppState, Router, String, String) {
    let dir = tempfile::tempdir().unwrap();
    let state = init(dir.path(), false).await.unwrap();
    let app = router(state.clone(), dir.path().join("static"));
    let restaurant: String = sqlx::query_scalar("SELECT id FROM restaurants LIMIT 1")
        .fetch_one(&state.db)
        .await
        .unwrap();
    let post = add_post(&state, &restaurant).await;
    (dir, state, app, restaurant, post)
}
async fn add_post(state: &AppState, restaurant: &str) -> String {
    let post = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO posts(id,restaurant_id,eaten_on,nickname,body,created_at) VALUES (?,?,'2026-10-11','','vote test',1)")
        .bind(&post).bind(restaurant).execute(&state.db).await.unwrap();
    post
}
async fn code(app: &Router, actor: &str) -> String {
    let (status, data) = call(
        app,
        "POST",
        "/api/sync",
        actor,
        None,
        json!({"local":{"version":1,"window_size":5,"meals":[]},"nickname":""}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    data["code"].as_str().unwrap().to_owned()
}
async fn vote(app: &Router, post: &str, actor: &str, code: Option<&str>, value: i64) -> Value {
    let (status, data) = call(
        app,
        "POST",
        &format!("/api/posts/{post}/vote"),
        actor,
        code,
        json!({"value":value}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    data
}
async fn listed(app: &Router, post: &str, actor: &str, code: Option<&str>) -> Value {
    let (status, data) = call(
        app,
        "GET",
        &format!("/api/posts?ids={post}"),
        actor,
        code,
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    data[0].clone()
}
async fn migrate(app: &Router, actor: &str, code: &str) {
    assert_eq!(
        call(
            app,
            "POST",
            "/api/sync/votes",
            actor,
            Some(code),
            Value::Null
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn shared_codes_have_one_vote_and_independent_codes_and_cookies_stay_separate() {
    let (_dir, _state, app, _restaurant, post) = setup().await;
    let a = Uuid::new_v4().to_string();
    let b = Uuid::new_v4().to_string();
    let shared = code(&app, &a).await;
    let other = code(&app, &b).await;
    assert_eq!(vote(&app, &post, &a, Some(&shared), 1).await["likes"], 1);
    assert_eq!(
        vote(&app, &post, &b, Some(&shared.to_uppercase()), 1).await["likes"],
        1
    );
    assert_eq!(listed(&app, &post, &b, Some(&shared)).await["my_vote"], 1);
    assert_eq!(listed(&app, &post, &b, None).await["my_vote"], 0);
    let down = vote(&app, &post, &b, Some(&shared), -1).await;
    assert_eq!(down["likes"], 0);
    assert_eq!(down["dislikes"], 1);
    assert_eq!(listed(&app, &post, &a, Some(&shared)).await["my_vote"], -1);
    assert_eq!(vote(&app, &post, &a, Some(&other), 1).await["likes"], 1);
    assert_eq!(listed(&app, &post, &a, Some(&other)).await["my_vote"], 1);
    let cancel = vote(&app, &post, &a, Some(&shared), 0).await;
    assert_eq!(cancel["dislikes"], 0);
    assert_eq!(cancel["likes"], 1);
    assert_eq!(vote(&app, &post, &a, None, 1).await["likes"], 2);
    assert_eq!(vote(&app, &post, &a, None, 0).await["likes"], 1);
}

#[tokio::test]
async fn migration_moves_cookie_votes_once_and_shared_choices_including_cancellation_win() {
    let (_dir, state, app, restaurant, first) = setup().await;
    let second = add_post(&state, &restaurant).await;
    let third = add_post(&state, &restaurant).await;
    let a = Uuid::new_v4().to_string();
    let b = Uuid::new_v4().to_string();
    let shared = code(&app, &a).await;
    vote(&app, &first, &a, Some(&shared), 1).await;
    vote(&app, &second, &a, Some(&shared), 1).await;
    vote(&app, &second, &a, Some(&shared), 0).await;
    vote(&app, &first, &a, None, -1).await;
    vote(&app, &second, &a, None, 1).await;
    vote(&app, &third, &a, None, -1).await;
    vote(&app, &first, &b, None, 1).await;
    // GET changes only which my_vote is selected; it cannot migrate the cookie.
    assert_eq!(listed(&app, &first, &a, Some(&shared)).await["my_vote"], 1);
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM votes WHERE voter_id=?")
        .bind(&a)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(before, 3);
    migrate(&app, &a, &shared).await;
    migrate(&app, &a, &shared).await;
    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM votes WHERE voter_id=?")
        .bind(&a)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(after, 0);
    let first_value = listed(&app, &first, &a, Some(&shared)).await;
    assert_eq!(first_value["likes"], 2);
    assert_eq!(first_value["dislikes"], 0);
    let second_value = listed(&app, &second, &a, Some(&shared)).await;
    assert_eq!(second_value["my_vote"], 0);
    assert_eq!(second_value["likes"], 0);
    assert_eq!(listed(&app, &third, &a, Some(&shared)).await["my_vote"], -1);
    assert_eq!(listed(&app, &third, &a, None).await["my_vote"], 0);
    migrate(&app, &b, &shared).await;
    assert_eq!(listed(&app, &first, &b, Some(&shared)).await["likes"], 1);
    // A newly connected old device cannot resurrect the shared cancellation.
    vote(&app, &second, &b, None, 1).await;
    migrate(&app, &b, &shared).await;
    assert_eq!(listed(&app, &second, &b, Some(&shared)).await["likes"], 0);
}

#[tokio::test]
async fn invalid_sync_headers_never_fall_back_to_cookie_votes_or_migrate_them() {
    let (_dir, state, app, _restaurant, post) = setup().await;
    let actor = Uuid::new_v4().to_string();
    vote(&app, &post, &actor, None, 1).await;
    for (invalid, expected) in [
        (String::new(), StatusCode::UNAUTHORIZED),
        ("not-a-code".into(), StatusCode::UNAUTHORIZED),
        (Uuid::new_v4().simple().to_string(), StatusCode::NOT_FOUND),
    ] {
        for (method, path, body) in [
            ("GET", "/api/posts".to_owned(), Value::Null),
            (
                "POST",
                format!("/api/posts/{post}/vote"),
                json!({"value":-1}),
            ),
            ("POST", "/api/sync/votes".to_owned(), Value::Null),
        ] {
            assert_eq!(
                call(&app, method, &path, &actor, Some(&invalid), body)
                    .await
                    .0,
                expected
            );
        }
    }
    assert_eq!(
        call(&app, "POST", "/api/sync/votes", &actor, None, Value::Null)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(listed(&app, &post, &actor, None).await["my_vote"], 1);
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM votes")
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn migration_is_atomic_on_failure_and_serializes_concurrent_retries() {
    let (_dir, state, app, _restaurant, post) = setup().await;
    let actor = Uuid::new_v4().to_string();
    let shared = code(&app, &actor).await;
    vote(&app, &post, &actor, None, 1).await;
    sqlx::query("CREATE TRIGGER reject_vote_move BEFORE DELETE ON votes BEGIN SELECT RAISE(ABORT, 'simulated delete failure'); END").execute(&state.db).await.unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/sync/votes",
            &actor,
            Some(&shared),
            Value::Null
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(listed(&app, &post, &actor, None).await["my_vote"], 1);
    assert_eq!(
        listed(&app, &post, &actor, Some(&shared)).await["my_vote"],
        0
    );
    sqlx::query("DROP TRIGGER reject_vote_move")
        .execute(&state.db)
        .await
        .unwrap();
    let guard = state.writes.lock().await;
    let pending = call(
        &app,
        "POST",
        "/api/sync/votes",
        &actor,
        Some(&shared),
        Value::Null,
    );
    tokio::pin!(pending);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(30), &mut pending)
            .await
            .is_err()
    );
    drop(guard);
    assert_eq!(pending.await.0, StatusCode::NO_CONTENT);
    let (left, right) = tokio::join!(
        call(
            &app,
            "POST",
            "/api/sync/votes",
            &actor,
            Some(&shared),
            Value::Null
        ),
        call(
            &app,
            "POST",
            "/api/sync/votes",
            &actor,
            Some(&shared),
            Value::Null
        )
    );
    assert_eq!(left.0, StatusCode::NO_CONTENT);
    assert_eq!(right.0, StatusCode::NO_CONTENT);
    assert_eq!(listed(&app, &post, &actor, Some(&shared)).await["likes"], 1);
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM votes")
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn post_creation_retries_return_my_vote_for_the_requested_identity() {
    let (_dir, _state, app, restaurant, post) = setup().await;
    let actor = Uuid::new_v4().to_string();
    let shared = code(&app, &actor).await;
    vote(&app, &post, &actor, None, -1).await;
    vote(&app, &post, &actor, Some(&shared), 1).await;
    let payload = json!({"id":post,"restaurant_id":restaurant,"eaten_on":"2026-10-11","nickname":"","body":"retry","record_meal":false});
    let multipart = format!(
        "--vote-test\r\nContent-Disposition: form-data; name=\"payload\"\r\n\r\n{payload}\r\n--vote-test--\r\n"
    );
    let request = Request::builder()
        .method("POST")
        .uri("/api/posts")
        .header("cookie", format!("wte_visitor={actor}"))
        .header("x-sync-code", shared)
        .header("content-type", "multipart/form-data; boundary=vote-test")
        .body(Body::from(multipart))
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body["my_vote"], 1);
}

#[tokio::test]
async fn upgrading_votes_preserves_legacy_rows_and_post_delete_still_cascades() {
    let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
    sqlx::raw_sql("PRAGMA foreign_keys=ON; CREATE TABLE posts(id TEXT PRIMARY KEY); CREATE TABLE votes(post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,voter_id TEXT NOT NULL,value INTEGER NOT NULL CHECK(value IN(-1,1)),PRIMARY KEY(post_id,voter_id)); INSERT INTO posts VALUES('post'); INSERT INTO votes VALUES('post','visitor',-1);").execute(&db).await.unwrap();
    sqlx::raw_sql(include_str!("../migrations/0010_sync_votes.sql"))
        .execute(&db)
        .await
        .unwrap();
    let value: i64 = sqlx::query_scalar("SELECT value FROM votes WHERE voter_id='visitor'")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(value, -1);
    sqlx::query("INSERT INTO votes VALUES('post','shared',0)")
        .execute(&db)
        .await
        .unwrap();
    sqlx::query("DELETE FROM posts WHERE id='post'")
        .execute(&db)
        .await
        .unwrap();
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM votes")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn concurrent_device_imports_and_shared_cancellation_leave_one_zero_choice() {
    let (_dir, state, app, _restaurant, post) = setup().await;
    let a = Uuid::new_v4().to_string();
    let b = Uuid::new_v4().to_string();
    let shared = code(&app, &a).await;
    vote(&app, &post, &a, None, 1).await;
    vote(&app, &post, &b, None, 1).await;
    let route = format!("/api/posts/{post}/vote");
    let (left, right, cancel) = tokio::join!(
        call(
            &app,
            "POST",
            "/api/sync/votes",
            &a,
            Some(&shared),
            Value::Null
        ),
        call(
            &app,
            "POST",
            "/api/sync/votes",
            &b,
            Some(&shared),
            Value::Null
        ),
        call(&app, "POST", &route, &a, Some(&shared), json!({"value": 0})),
    );
    assert_eq!(left.0, StatusCode::NO_CONTENT);
    assert_eq!(right.0, StatusCode::NO_CONTENT);
    assert_eq!(cancel.0, StatusCode::OK);
    let result = listed(&app, &post, &b, Some(&shared)).await;
    assert_eq!(result["my_vote"], 0);
    assert_eq!(result["likes"], 0);
    assert_eq!(result["dislikes"], 0);
    let rows: Vec<(String, i64)> = sqlx::query_as("SELECT voter_id,value FROM votes")
        .fetch_all(&state.db)
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert!(rows[0].0.starts_with("sync:"));
    assert_eq!(rows[0].1, 0);
}
