-- Per-rig monotonic revision used for optimistic concurrency on PUT /api/rigs/{id}.
ALTER TABLE rigs ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
