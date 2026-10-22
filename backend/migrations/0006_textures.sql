-- Textures (Session 5): the rig's musical ideas. One row per texture, keyed like scenes so a
-- duplicated or imported rig keeps the ids its mappings and base-scene references point at.
-- Rigs saved before this migration simply have no rows here; nothing else is touched.
CREATE TABLE IF NOT EXISTS textures (
    id          TEXT NOT NULL,
    rig_id      TEXT NOT NULL REFERENCES rigs(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL,
    data        TEXT NOT NULL,            -- full Texture JSON
    PRIMARY KEY (rig_id, id)
);
CREATE INDEX IF NOT EXISTS idx_textures_rig ON textures(rig_id);
