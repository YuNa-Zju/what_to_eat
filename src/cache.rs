use axum::{
    extract::Request,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware::Next,
    response::Response,
};
use md5::{Digest, Md5};

pub const IMMUTABLE: &str = "public, max-age=31536000, immutable";

pub fn etag(bytes: &[u8]) -> String {
    format!("\"{:x}\"", Md5::digest(bytes))
}

// GET and HEAD use weak comparison, including lists and repeated header fields.
pub fn matches(headers: &HeaderMap, etag: &str) -> bool {
    headers.get_all(header::IF_NONE_MATCH).iter().any(|value| {
        value.to_str().is_ok_and(|value| {
            value.split(',').any(|candidate| {
                let candidate = candidate.trim();
                candidate == "*" || candidate.strip_prefix("W/").unwrap_or(candidate) == etag
            })
        })
    })
}

pub fn with_headers(mut response: Response, etag: &str, policy: &'static str) -> Response {
    response.headers_mut().insert(
        header::ETAG,
        HeaderValue::from_str(etag).expect("server-generated hexadecimal ETag"),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(policy));
    response
}

fn versioned_asset(path: &str) -> bool {
    if !path.starts_with("/assets/") {
        return false;
    }
    let Some((stem, _extension)) = path.rsplit_once('.') else {
        return false;
    };
    // Vite's default output includes an eight-character base64url content hash.
    let bytes = stem.as_bytes();
    bytes.len() > 9
        && bytes[bytes.len() - 9] == b'-'
        && bytes[bytes.len() - 8..]
            .iter()
            .all(|c| c.is_ascii_alphanumeric() || *c == b'_' || *c == b'-')
}

pub async fn static_headers(request: Request, next: Next) -> Response {
    let immutable = versioned_asset(request.uri().path());
    let mut response = next.run(request).await;
    let policy = match response.status() {
        StatusCode::OK | StatusCode::NOT_MODIFIED if immutable => IMMUTABLE,
        StatusCode::OK | StatusCode::NOT_MODIFIED => "no-cache",
        _ => "no-store",
    };
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(policy));
    response
}
