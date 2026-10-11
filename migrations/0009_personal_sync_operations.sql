-- Keep receipts for delayed offline retries; never expire them independently
-- of the book. They contain no copy of the private meal history.
CREATE TABLE personal_sync_operations (
    code_hash TEXT NOT NULL REFERENCES personal_sync(code_hash) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    revision INTEGER NOT NULL,
    PRIMARY KEY (code_hash, operation_id)
) WITHOUT ROWID;
