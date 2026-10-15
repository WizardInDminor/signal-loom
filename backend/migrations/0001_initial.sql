-- Signal Loom initial schema.
-- Core entities get their own rows with stable ids; nested detail is stored as JSON text
-- (validated by Pydantic before it is written). Children cascade with their rig.

CREATE TABLE IF NOT EXISTS device_profiles (
    id          TEXT PRIMARY KEY,
    source      TEXT NOT NULL,            -- builtin | custom | imported
    manufacturer TEXT NOT NULL,
    model       TEXT NOT NULL,
    category    TEXT NOT NULL,
    data        TEXT NOT NULL,            -- full DeviceProfile JSON
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rigs (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    board       TEXT NOT NULL,            -- Board JSON
    controllers TEXT NOT NULL,            -- Controllers JSON (MC8 / ML10X plans)
    notes       TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_instances (
    id          TEXT NOT NULL,
    rig_id      TEXT NOT NULL REFERENCES rigs(id) ON DELETE CASCADE,
    profile_id  TEXT NOT NULL,
    label       TEXT NOT NULL,
    x_mm        REAL NOT NULL,
    y_mm        REAL NOT NULL,
    rotation    INTEGER NOT NULL,
    sort_order  INTEGER NOT NULL,
    data        TEXT NOT NULL,            -- full DeviceInstance JSON
    PRIMARY KEY (rig_id, id)              -- ids are stable per rig; duplicates/imports keep them
);
CREATE INDEX IF NOT EXISTS idx_instances_rig ON device_instances(rig_id);

CREATE TABLE IF NOT EXISTS connections (
    id          TEXT NOT NULL,
    rig_id      TEXT NOT NULL REFERENCES rigs(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    source_instance_id TEXT NOT NULL,
    source_port_id     TEXT NOT NULL,
    target_instance_id TEXT NOT NULL,
    target_port_id     TEXT NOT NULL,
    sort_order  INTEGER NOT NULL,
    data        TEXT NOT NULL,            -- full Connection JSON
    PRIMARY KEY (rig_id, id)
);
CREATE INDEX IF NOT EXISTS idx_connections_rig ON connections(rig_id);

CREATE TABLE IF NOT EXISTS scenes (
    id          TEXT NOT NULL,
    rig_id      TEXT NOT NULL REFERENCES rigs(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL,
    data        TEXT NOT NULL,            -- full Scene JSON
    PRIMARY KEY (rig_id, id)
);
CREATE INDEX IF NOT EXISTS idx_scenes_rig ON scenes(rig_id);
