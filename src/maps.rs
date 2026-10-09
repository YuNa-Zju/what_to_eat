use crate::{
    AppState,
    error::{AppError, Result},
};
use axum::{
    Json,
    body::Body,
    extract::{Path, RawQuery, State},
    http::{HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use std::{sync::Arc, time::Duration};

#[derive(Clone)]
pub struct MapConfig {
    pub key: String,
    secret: String,
    client: reqwest::Client,
    slots: Arc<tokio::sync::Semaphore>,
}
impl MapConfig {
    pub fn from_env() -> Option<Self> {
        let key = std::env::var("AMAP_JS_KEY").ok()?.trim().to_string();
        let secret = std::env::var("AMAP_SECURITY_JS_CODE")
            .ok()?
            .trim()
            .to_string();
        if key.is_empty() || secret.is_empty() {
            return None;
        }
        Some(Self {
            key,
            secret,
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(12))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .ok()?,
            slots: Arc::new(tokio::sync::Semaphore::new(8)),
        })
    }
}
pub async fn config(State(s): State<AppState>) -> Json<serde_json::Value> {
    Json(match &s.maps {
        Some(m) => serde_json::json!({"enabled":true,"key":m.key,"serviceHost":"/_AMapService"}),
        None => serde_json::json!({"enabled":false}),
    })
}
// Only the services used by the JS SDK are forwarded; this is not an open proxy.
pub async fn proxy(
    State(s): State<AppState>,
    Path(path): Path<String>,
    RawQuery(query): RawQuery,
) -> Result<Response> {
    let maps = s
        .maps
        .as_ref()
        .ok_or_else(|| AppError(StatusCode::SERVICE_UNAVAILABLE, "地图尚未配置".into()))?;
    let host = match path.as_str() {
        "v5/place/text"
        | "v5/place/around"
        | "v5/place/detail"
        | "v3/place/text"
        | "v3/place/around"
        | "v3/place/detail"
        | "v3/assistant/inputtips"
        | "v3/assistant/coordinate/convert"
        | "v3/geocode/geo"
        | "v3/geocode/regeo"
        | "v3/ip"
        | "v3/config/district" => "https://restapi.amap.com/",
        "v4/map/styles" => "https://webapi.amap.com/",
        _ => return Err(AppError::missing()),
    };
    let query = query.unwrap_or_default();
    if query.len() > 4096 {
        return Err(AppError::bad("地图请求过长"));
    }
    let _slot = maps
        .slots
        .try_acquire()
        .map_err(|_| AppError(StatusCode::TOO_MANY_REQUESTS, "地图繁忙，请稍后重试".into()))?;
    let incoming = reqwest::Url::parse(&format!("https://local.invalid/?{query}"))
        .map_err(|_| AppError::bad("无效的地图请求"))?;
    let callback = incoming
        .query_pairs()
        .find(|(key, _)| key == "callback")
        .map(|(_, value)| value.into_owned());
    if callback.as_ref().is_some_and(|name| !valid_callback(name)) {
        return Err(AppError::bad("无效的地图回调"));
    }
    let mut url = reqwest::Url::parse(&format!("{host}{path}")).expect("fixed map host");
    {
        let mut pairs = url.query_pairs_mut();
        for (k, v) in incoming.query_pairs() {
            if k != "key" && k != "jscode" && k != "callback" {
                pairs.append_pair(&k, &v);
            }
        }
        if let Some(callback) = &callback {
            pairs.append_pair("callback", callback);
        }
        pairs
            .append_pair("key", &maps.key)
            .append_pair("jscode", &maps.secret);
    }
    let upstream = maps
        .client
        .get(url)
        .send()
        .await
        .map_err(|_| AppError(StatusCode::BAD_GATEWAY, "地图服务暂时不可用".into()))?;
    if !upstream.status().is_success() {
        return Err(AppError(StatusCode::BAD_GATEWAY, "地图服务请求失败".into()));
    }
    // Stream with a cap rather than buffering an unbounded provider response.
    let mime = upstream
        .headers()
        .get("content-type")
        .cloned()
        .unwrap_or(HeaderValue::from_static("application/json"));
    let mut upstream = upstream;
    let mut bytes = Vec::new();
    while let Some(chunk) = upstream
        .chunk()
        .await
        .map_err(|_| AppError(StatusCode::BAD_GATEWAY, "地图响应中断".into()))?
    {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err(AppError::bad("地图响应过大"));
        }
        bytes.extend_from_slice(&chunk);
    }
    let mut response = Body::from(bytes).into_response();
    // AMap returns JSONP with an application/json MIME on some endpoints.
    // Keep nosniff enabled and label validated SDK callbacks as JavaScript.
    response.headers_mut().insert(
        "content-type",
        if callback.is_some() {
            HeaderValue::from_static("application/javascript; charset=utf-8")
        } else {
            mime
        },
    );
    response
        .headers_mut()
        .insert("cache-control", HeaderValue::from_static("no-store"));
    Ok(response)
}

fn valid_callback(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name.split('.').all(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic() || c == '_' || c == '$')
                && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
        })
}

#[cfg(test)]
mod tests {
    use super::valid_callback;
    #[test]
    fn jsonp_callback_is_an_identifier_not_code() {
        assert!(valid_callback("jsonp_357201_123_"));
        assert!(valid_callback("amap.callback"));
        for invalid in ["", "alert(1)", "a;b", "a..b", "123", "a[0]"] {
            assert!(!valid_callback(invalid));
        }
    }
}
