CREATE TABLE photo_uploads (
    id TEXT PRIMARY KEY,
    image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    visitor_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    post_id TEXT REFERENCES posts(id) ON DELETE CASCADE
);
CREATE INDEX photo_uploads_image ON photo_uploads(image_id);
CREATE INDEX photo_uploads_expiry ON photo_uploads(expires_at);
