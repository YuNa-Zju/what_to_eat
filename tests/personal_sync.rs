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
use what_to_eat::{init, router};

async fn response(
    app: &Router,
    method: &str,
    code: Option<&str>,
    body: Value,
    headers: &[(&str, &str)],
) -> Response {
    let mut req = Request::builder()
        .method(method)
        .uri("/api/sync")
        .header("content-type", "application/json");
    if let Some(code) = code {
        req = req.header("x-sync-code", code);
    }
    for (name, value) in headers {
        req = req.header(*name, *value);
    }
    let response = app
        .clone()
        .oneshot(req.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    assert_eq!(response.headers().get("cache-control").unwrap(), "no-store");
    response
}
async fn call_headers(
    app: &Router,
    method: &str,
    code: Option<&str>,
    body: Value,
    headers: &[(&str, &str)],
) -> (StatusCode, Value) {
    let response = response(app, method, code, body, headers).await;
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn call(app: &Router, method: &str, code: Option<&str>, body: Value) -> (StatusCode, Value) {
    call_headers(app, method, code, body, &[]).await
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

#[tokio::test]
async fn unchanged_reads_have_no_body_and_changed_reads_return_the_current_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let state = init(dir.path(), false).await.unwrap();
    let app = router(state, dir.path().join("static"));
    let data = content();
    let created = call(&app, "POST", None, data.clone()).await.1;
    let code = created["code"].as_str().unwrap();
    let unchanged = response(
        &app,
        "GET",
        Some(code),
        Value::Null,
        &[("x-sync-revision", "1")],
    )
    .await;
    assert_eq!(unchanged.status(), StatusCode::NO_CONTENT);
    assert_eq!(unchanged.headers()["x-sync-revision"], "1");
    assert!(
        unchanged
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .is_empty()
    );
    for invalid in ["", "0", "-1", "1.5", "not-a-number", "9223372036854775808"] {
        assert_eq!(
            call_headers(
                &app,
                "GET",
                Some(code),
                Value::Null,
                &[("x-sync-revision", invalid)]
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(
        call_headers(&app, "GET", None, Value::Null, &[("x-sync-revision", "1")])
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call_headers(
            &app,
            "GET",
            Some(&Uuid::new_v4().simple().to_string()),
            Value::Null,
            &[("x-sync-revision", "1")]
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let mut edited = data;
    edited["nickname"] = json!("另一台设备");
    assert_eq!(
        call(
            &app,
            "PUT",
            Some(code),
            json!({"revision":1,"content":edited})
        )
        .await
        .0,
        StatusCode::OK
    );
    let changed = response(
        &app,
        "GET",
        Some(code),
        Value::Null,
        &[("x-sync-revision", "1")],
    )
    .await;
    assert_eq!(changed.status(), StatusCode::OK);
    assert_eq!(changed.headers()["x-sync-revision"], "2");
    let changed: Value =
        serde_json::from_slice(&changed.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(changed, json!({"revision":2,"content":edited}));
    assert_eq!(call(&app, "GET", Some(code), Value::Null).await.1, changed);
}

#[tokio::test]
async fn lost_response_retries_survive_other_edits_and_restart_without_reapplying() {
    let dir = tempfile::tempdir().unwrap();
    let state = init(dir.path(), false).await.unwrap();
    let app = router(state.clone(), dir.path().join("static"));
    let data = content();
    let created = call(&app, "POST", None, data.clone()).await.1;
    let code = created["code"].as_str().unwrap();
    let operation = Uuid::new_v4().to_string();
    let first = json!({"revision":1,"content":data});
    let confirmed = call_headers(
        &app,
        "PUT",
        Some(code),
        first.clone(),
        &[("x-sync-operation", &operation)],
    )
    .await;
    assert_eq!(confirmed.0, StatusCode::OK);
    assert_eq!(confirmed.1["revision"], 2);
    assert_eq!(
        call_headers(
            &app,
            "PUT",
            Some(code),
            first.clone(),
            &[("x-sync-operation", &operation)]
        )
        .await,
        confirmed
    );
    let mut later = data;
    later["local"]["meals"] = json!([]);
    later["nickname"] = json!("后来的修改");
    assert_eq!(
        call(
            &app,
            "PUT",
            Some(code),
            json!({"revision":2,"content":later})
        )
        .await
        .0,
        StatusCode::OK
    );
    drop(app);
    state.db.close().await;
    let reopened = init(dir.path(), false).await.unwrap();
    let app = router(reopened.clone(), dir.path().join("static"));
    assert_eq!(
        call_headers(
            &app,
            "PUT",
            Some(code),
            first,
            &[("x-sync-operation", &operation)]
        )
        .await,
        confirmed
    );
    assert_eq!(
        call(&app, "GET", Some(code), Value::Null).await.1,
        json!({"revision":3,"content":later})
    );
    let receipts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM personal_sync_operations")
        .fetch_one(&reopened.db)
        .await
        .unwrap();
    assert_eq!(receipts, 1);
}

#[tokio::test]
async fn operation_ids_cannot_change_payloads_but_are_scoped_to_the_sync_code() {
    let dir = tempfile::tempdir().unwrap();
    let state = init(dir.path(), false).await.unwrap();
    let app = router(state, dir.path().join("static"));
    let data = content();
    let a = call(&app, "POST", None, data.clone()).await.1;
    let b = call(&app, "POST", None, content()).await.1;
    let code = a["code"].as_str().unwrap();
    let operation = Uuid::new_v4().to_string();
    let headers = [("x-sync-operation", operation.as_str())];
    let first = json!({"revision":1,"content":data});
    let confirmed = call_headers(&app, "PUT", Some(code), first.clone(), &headers).await;
    assert_eq!(confirmed.0, StatusCode::OK);
    let mut changed = first.clone();
    changed["content"]["nickname"] = json!("不是原请求");
    for body in [changed, json!({"revision":2,"content":data})] {
        let result = call_headers(&app, "PUT", Some(code), body, &headers).await;
        assert_eq!(result.0, StatusCode::BAD_REQUEST);
        assert!(result.1["error"].as_str().unwrap().contains("操作编号"));
    }
    assert_eq!(
        call(&app, "GET", Some(code), Value::Null).await.1,
        confirmed.1
    );
    assert_eq!(
        call_headers(
            &app,
            "PUT",
            Some(b["code"].as_str().unwrap()),
            json!({"revision":1,"content":b["content"]}),
            &headers
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call_headers(
            &app,
            "PUT",
            Some(code),
            first,
            &[("x-sync-operation", "invalid")]
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn sync_updates_wait_for_existing_writers_before_touching_the_database() {
    let dir = tempfile::tempdir().unwrap();
    let state = init(dir.path(), false).await.unwrap();
    let app = router(state.clone(), dir.path().join("static"));
    let data = content();
    let created = call(&app, "POST", None, data.clone()).await.1;
    let code = created["code"].as_str().unwrap();
    for (revision, operation) in [(1, None), (2, Some(Uuid::new_v4().to_string()))] {
        let guard = state.writes.lock().await;
        let mut tx = state.db.begin().await.unwrap();
        let before: i64 = sqlx::query_scalar("SELECT window_size FROM settings WHERE id=1")
            .fetch_one(&mut *tx)
            .await
            .unwrap();
        let headers: Vec<_> = operation
            .as_deref()
            .map(|id| vec![("x-sync-operation", id)])
            .unwrap_or_default();
        let update = call_headers(
            &app,
            "PUT",
            Some(code),
            json!({"revision":revision,"content":data}),
            &headers,
        );
        tokio::pin!(update);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(30), &mut update)
                .await
                .is_err()
        );
        // Upgrading this existing reader must still work: the waiting sync
        // update must not have committed an unrelated write in the meantime.
        sqlx::query("UPDATE settings SET window_size=? WHERE id=1")
            .bind(before + 1)
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        drop(guard);
        let (status, result) = tokio::time::timeout(std::time::Duration::from_secs(2), update)
            .await
            .unwrap();
        assert_eq!(status, StatusCode::OK);
        assert_eq!(result["revision"], revision + 1);
    }
}

#[tokio::test]
async fn concurrent_retries_write_once_and_distinct_operations_keep_compare_and_swap() {
    let dir = tempfile::tempdir().unwrap();
    let state = init(dir.path(), false).await.unwrap();
    let app = router(state.clone(), dir.path().join("static"));
    let data = content();
    let created = call(&app, "POST", None, data.clone()).await.1;
    let code = created["code"].as_str().unwrap();
    let operation = Uuid::new_v4().to_string();
    let headers = [("x-sync-operation", operation.as_str())];
    let first = json!({"revision":1,"content":data});
    let (left, right) = tokio::join!(
        call_headers(&app, "PUT", Some(code), first.clone(), &headers),
        call_headers(&app, "PUT", Some(code), first, &headers)
    );
    assert_eq!(left.0, StatusCode::OK);
    assert_eq!(left, right);
    let second = json!({"revision":2,"content":data});
    let a = Uuid::new_v4().to_string();
    let b = Uuid::new_v4().to_string();
    let ha = [("x-sync-operation", a.as_str())];
    let hb = [("x-sync-operation", b.as_str())];
    let (left, right) = tokio::join!(
        call_headers(&app, "PUT", Some(code), second.clone(), &ha),
        call_headers(&app, "PUT", Some(code), second, &hb)
    );
    let mut statuses = [left.0.as_u16(), right.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, [200, 409]);
    assert_eq!(
        call(&app, "GET", Some(code), Value::Null).await.1["revision"],
        3
    );
    let receipts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM personal_sync_operations")
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(receipts, 2);
}

#[tokio::test]
async fn receipt_failure_rolls_back_the_content_and_revision_together() {
    let dir = tempfile::tempdir().unwrap();
    let state = init(dir.path(), false).await.unwrap();
    let app = router(state.clone(), dir.path().join("static"));
    let data = content();
    let created = call(&app, "POST", None, data.clone()).await.1;
    let code = created["code"].as_str().unwrap();
    sqlx::query("CREATE TRIGGER reject_sync_receipt BEFORE INSERT ON personal_sync_operations BEGIN SELECT RAISE(ABORT, 'simulated receipt failure'); END").execute(&state.db).await.unwrap();
    let mut changed = data.clone();
    changed["nickname"] = json!("应当回滚");
    let operation = Uuid::new_v4().to_string();
    let input = json!({"revision":1,"content":changed});
    assert_eq!(
        call_headers(
            &app,
            "PUT",
            Some(code),
            input.clone(),
            &[("x-sync-operation", &operation)]
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        call(&app, "GET", Some(code), Value::Null).await.1,
        json!({"revision":1,"content":data})
    );
    sqlx::query("DROP TRIGGER reject_sync_receipt")
        .execute(&state.db)
        .await
        .unwrap();
    assert_eq!(
        call_headers(
            &app,
            "PUT",
            Some(code),
            input,
            &[("x-sync-operation", &operation)]
        )
        .await
        .1,
        json!({"revision":2,"content":changed})
    );
}
