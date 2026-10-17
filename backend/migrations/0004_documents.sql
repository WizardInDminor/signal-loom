-- User-supplied PDF documents (device manuals, quick-start guides, MIDI implementation charts).
-- The bytes live in the managed document directory next to the database, named by id only;
-- this table holds what the app needs to serve, render and validate them. A profile refers to a
-- document by id plus its own title; nothing here enters a project file unless the user opts in.
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    content_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    page_count INTEGER,
    original_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
