"""Persistence of workstation-local live bindings, apart from the portable rig document."""

from __future__ import annotations

import json

from ..db import Database
from ..models.live import LiveBindings
from ..models.rig import utcnow_iso


class LiveBindingsRepository:
    def __init__(self, db: Database):
        self.db = db

    def get(self, rig_id: str) -> LiveBindings:
        row = self.db.conn.execute("SELECT data FROM live_bindings WHERE rig_id = ?", (rig_id,)).fetchone()
        if row is None:
            return LiveBindings(rig_id=rig_id)
        data = json.loads(row["data"])
        data["rig_id"] = rig_id
        return LiveBindings.model_validate(data)

    def save(self, bindings: LiveBindings) -> LiveBindings:
        bindings.updated_at = utcnow_iso()
        with self.db.tx() as c:
            c.execute(
                "INSERT INTO live_bindings(rig_id, data, updated_at) VALUES (?,?,?) "
                "ON CONFLICT(rig_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
                (bindings.rig_id, json.dumps(bindings.model_dump(mode="json"), sort_keys=True), bindings.updated_at),
            )
        return bindings

    def delete(self, rig_id: str) -> None:
        with self.db.tx() as c:
            c.execute("DELETE FROM live_bindings WHERE rig_id = ?", (rig_id,))
