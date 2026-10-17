-- User-supplied binary assets (device photographs). The bytes live in the managed asset
-- directory next to the database, named by id only; this table holds what the app needs to
-- serve and validate them. Nothing here is ever part of a project file unless the user opts in.
CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    content_type TEXT NOT NULL,
    ext TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    byte_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    original_name TEXT,
    created_at TEXT NOT NULL
);
