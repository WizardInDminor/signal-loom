-- Workstation-local live-MIDI bindings (Session 4). One row per rig: which OS/virtual MIDI
-- endpoints are plugged into which device's USB jack, deliberate shared-channel groups, the
-- send delay and the transport mode. Endpoint names are specific to this computer, so this
-- never enters a project file; physical cables remain ordinary rig connections.
CREATE TABLE IF NOT EXISTS live_bindings (
    rig_id     TEXT PRIMARY KEY REFERENCES rigs(id) ON DELETE CASCADE,
    data       TEXT NOT NULL,            -- LiveBindings JSON
    updated_at TEXT NOT NULL
);
