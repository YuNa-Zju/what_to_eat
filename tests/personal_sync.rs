use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;
use what_to_eat::{init, router};

async fn call(app: &Router, method: &str, code: Option<&str>, body: Value) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri("/api/sync")
        .header("content-type", "application/json");
    if let Some(code) = code {
        req = req.header("x-sync-code", code);
    }
    let response = app
        .clone()
        .oneshot(req.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    assert_eq!(response.headers().get("cache-control").unwrap(), "no-store");
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
fn content() -> Value {
    json!({"local":{"version":1,"window_size":5,"meals":[{"id":Uuid::new_v4().to_string(),"restaurant_id":Uuid::new_v4().to_string(),"eaten_on":"2026-10-11","created_at":1791676800000_i64,"rating":1,"cost_cents":3500,"post_ids":[Uuid::new_v4().to_string()]}]},"nickname":"同步饭友"})
}
#[tokio::test]
async fn code_is_required_and_stored_only_as_hash_private_meals_never_enter_shared_history() {
    let dir = tempfile::tempdir().unwrap();
    let state = init(dir.path(), false).await.unwrap();
    let app = router(state.clone(), dir.path().join("static"));
    let data = content();
    let (status, created) = call(&app, "POST", None, data.clone()).await;
    assert_eq!(status, StatusCode::OK);
    let code = created["code"].as_str().unwrap();
    assert_eq!(code.len(), 32);
    let stored: String = sqlx::query_scalar("SELECT code_hash FROM personal_sync")
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_ne!(stored, code);
    assert_eq!(stored.len(), 64);
    assert_eq!(
        call(&app, "GET", None, Value::Null).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &app,
            "GET",
            Some(&Uuid::new_v4().simple().to_string()),
            Value::Null
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let fetched = call(&app, "GET", Some(&code.to_uppercase()), Value::Null).await;
    assert_eq!(fetched.0, StatusCode::OK);
    assert_eq!(fetched.1["content"], data);
    assert!(fetched.1.get("code").is_none());
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meals")
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(count, 0);
    drop(app);
    state.db.close().await;
    let reopened = init(dir.path(), false).await.unwrap();
    let app = router(reopened, dir.path().join("static"));
    assert_eq!(
        call(&app, "GET", Some(code), Value::Null).await.1["content"],
        data
    );
}
#[tokio::test]
async fn stale_writes_cannot_overwrite_newer_edits_or_restore_deleted_records() {
    let dir = tempfile::tempdir().unwrap();
    let state = init(dir.path(), false).await.unwrap();
    let app = router(state, dir.path().join("static"));
    let data = content();
    let created = call(&app, "POST", None, data.clone()).await.1;
    let code = created["code"].as_str().unwrap();
    let mut deleted = data.clone();
    deleted["local"]["meals"] = json!([]);
    deleted["nickname"] = json!("");
    let result = call(
        &app,
        "PUT",
        Some(code),
        json!({"revision":1,"content":deleted}),
    )
    .await;
    assert_eq!(result.0, StatusCode::OK);
    assert_eq!(result.1["revision"], 2);
    assert_eq!(
        call(
            &app,
            "PUT",
            Some(code),
            json!({"revision":1,"content":data})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(&app, "GET", Some(code), Value::Null).await.1["content"],
        deleted
    );
}
#[tokio::test]
async fn invalid_sync_payloads_never_replace_existing_data() {
    let dir = tempfile::tempdir().unwrap();
    let state = init(dir.path(), false).await.unwrap();
    let app = router(state, dir.path().join("static"));
    let data = content();
    let created = call(&app, "POST", None, data.clone()).await.1;
    let code = created["code"].as_str().unwrap();
    for field in ["window", "date", "cost", "duplicate", "nickname"] {
        let mut bad = data.clone();
        match field {
            "window" => bad["local"]["window_size"] = json!(0),
            "date" => bad["local"]["meals"][0]["eaten_on"] = json!("2026-02-30"),
            "cost" => bad["local"]["meals"][0]["cost_cents"] = json!(-1),
            "duplicate" => {
                let m = bad["local"]["meals"][0].clone();
                bad["local"]["meals"].as_array_mut().unwrap().push(m);
            }
            _ => bad["nickname"] = json!("饭".repeat(41)),
        }
        assert_eq!(
            call(&app, "PUT", Some(code), json!({"revision":1,"content":bad}))
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
    }
    let mut bad = data.clone();
    bad["draft"] = json!("should stay local");
    assert_eq!(
        call(&app, "POST", None, bad).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        call(&app, "GET", Some(code), Value::Null).await.1["content"],
        data
    );
}
#[tokio::test]
async fn sync_codes_are_isolated_and_cross_origin_writes_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let state = init(dir.path(), false).await.unwrap();
    let app = router(state, dir.path().join("static"));
    let a = call(&app, "POST", None, content()).await.1;
    let b = call(&app, "POST", None, content()).await.1;
    assert_ne!(a["code"], b["code"]);
    let req = Request::builder()
        .method("PUT")
        .uri("/api/sync")
        .header("content-type", "application/json")
        .header("host", "food.test")
        .header("origin", "https://other.test")
        .header("x-sync-code", a["code"].as_str().unwrap())
        .body(Body::from(
            json!({"revision":1,"content":content()}).to_string(),
        ))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(req).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&app, "GET", Some(b["code"].as_str().unwrap()), Value::Null)
            .await
            .1["content"],
        b["content"]
    );
}
