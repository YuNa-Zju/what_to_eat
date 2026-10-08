CREATE TABLE restaurants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at INTEGER NOT NULL
);
CREATE TABLE settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    window_size INTEGER NOT NULL CHECK (window_size BETWEEN 1 AND 100)
);
INSERT INTO settings VALUES (1, 5);
CREATE TABLE meals (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
    eaten_on TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX meals_recent ON meals(eaten_on DESC, created_at DESC);
CREATE TABLE posts (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
    eaten_on TEXT NOT NULL,
    nickname TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    shared_meal_id TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX posts_recent ON posts(created_at DESC, id DESC);
CREATE TABLE images (
    id TEXT PRIMARY KEY,
    md5 TEXT NOT NULL,
    size INTEGER NOT NULL,
    mime TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    pending_delete INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE INDEX images_digest ON images(md5, size);
CREATE TABLE post_images (
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    image_id TEXT NOT NULL REFERENCES images(id),
    position INTEGER NOT NULL,
    PRIMARY KEY (post_id, image_id)
);
CREATE INDEX images_references ON post_images(image_id);
CREATE TABLE votes (
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    voter_id TEXT NOT NULL,
    value INTEGER NOT NULL CHECK (value IN (-1, 1)),
    PRIMARY KEY (post_id, voter_id)
);
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
