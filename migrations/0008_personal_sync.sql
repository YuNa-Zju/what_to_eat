CREATE TABLE personal_sync (
    code_hash TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    creator TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX personal_sync_creator ON personal_sync(creator, created_at);
