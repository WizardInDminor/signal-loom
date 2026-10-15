"""Persistence for rigs and device profiles.

The rig is one document in the API, but it is stored as normalized rows so that every
instance, connection and scene has a stable row and id. Saving a rig upserts children by
id and deletes children that disappeared from the document.
"""

from __future__ import annotations

import json
from typing import Any

from .db import Database
from .models.common import DeviceCategory
from .models.profile import DeviceProfile
from .models.rig import (
    Board,
    Connection,
    Controllers,
    DeviceInstance,
    Rig,
    RigSummary,
    Scene,
    utcnow_iso,
)


def _dump(model: Any) -> str:
    return json.dumps(model.model_dump(mode="json"), sort_keys=True)


class RigRepository:
    def __init__(self, db: Database):
        self.db = db

    # -- rigs -----------------------------------------------------------------------
    def list(self) -> list[RigSummary]:
        rows = self.db.conn.execute(
            "SELECT r.id, r.name, r.description, r.created_at, r.updated_at, "
            "(SELECT COUNT(*) FROM device_instances i WHERE i.rig_id = r.id) AS n_inst, "
            "(SELECT COUNT(*) FROM scenes s WHERE s.rig_id = r.id) AS n_scenes "
            "FROM rigs r ORDER BY r.updated_at DESC"
        ).fetchall()
        return [
            RigSummary(
                id=r["id"],
                name=r["name"],
                description=r["description"],
                created_at=r["created_at"],
                updated_at=r["updated_at"],
                instance_count=r["n_inst"],
                scene_count=r["n_scenes"],
            )
            for r in rows
        ]

    def get(self, rig_id: str) -> Rig | None:
        c = self.db.conn
        row = c.execute("SELECT * FROM rigs WHERE id = ?", (rig_id,)).fetchone()
        if row is None:
            return None
        instances = [
            DeviceInstance.model_validate(json.loads(r["data"]))
            for r in c.execute("SELECT data FROM device_instances WHERE rig_id = ? ORDER BY sort_order", (rig_id,))
        ]
        connections = [
            Connection.model_validate(json.loads(r["data"]))
            for r in c.execute("SELECT data FROM connections WHERE rig_id = ? ORDER BY sort_order", (rig_id,))
        ]
        scenes = [
            Scene.model_validate(json.loads(r["data"]))
            for r in c.execute("SELECT data FROM scenes WHERE rig_id = ? ORDER BY sort_order", (rig_id,))
        ]
        return Rig(
            id=row["id"],
            name=row["name"],
            description=row["description"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            board=Board.model_validate(json.loads(row["board"])),
            controllers=Controllers.model_validate(json.loads(row["controllers"])),
            notes=row["notes"],
            instances=instances,
            connections=connections,
            scenes=scenes,
        )

    def exists(self, rig_id: str) -> bool:
        return self.db.conn.execute("SELECT 1 FROM rigs WHERE id = ?", (rig_id,)).fetchone() is not None

    def save(self, rig: Rig, *, touch: bool = True) -> Rig:
        """Insert or fully update a rig document. Returns the stored rig."""
        if touch:
            rig.updated_at = utcnow_iso()
        with self.db.tx() as c:
            c.execute(
                "INSERT INTO rigs(id, name, description, board, controllers, notes, created_at, "
                "updated_at) VALUES (?,?,?,?,?,?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, "
                "board=excluded.board, controllers=excluded.controllers, notes=excluded.notes, "
                "updated_at=excluded.updated_at",
                (
                    rig.id,
                    rig.name,
                    rig.description,
                    _dump(rig.board),
                    _dump(rig.controllers),
                    rig.notes,
                    rig.created_at,
                    rig.updated_at,
                ),
            )
            self._sync_children(
                c,
                "device_instances",
                rig.id,
                [
                    (
                        i.id,
                        {
                            "profile_id": i.profile_id,
                            "label": i.label,
                            "x_mm": i.x_mm,
                            "y_mm": i.y_mm,
                            "rotation": i.rotation,
                        },
                        _dump(i),
                    )
                    for i in rig.instances
                ],
            )
            self._sync_children(
                c,
                "connections",
                rig.id,
                [
                    (
                        k.id,
                        {
                            "kind": k.kind.value,
                            "source_instance_id": k.source.instance_id,
                            "source_port_id": k.source.port_id,
                            "target_instance_id": k.target.instance_id,
                            "target_port_id": k.target.port_id,
                        },
                        _dump(k),
                    )
                    for k in rig.connections
                ],
            )
            self._sync_children(
                c,
                "scenes",
                rig.id,
                [(s.id, {"name": s.name}, _dump(s)) for s in rig.scenes],
            )
        return rig

    @staticmethod
    def _sync_children(c, table: str, rig_id: str, rows: list[tuple[str, dict, str]]) -> None:
        keep_ids = [r[0] for r in rows]
        if keep_ids:
            placeholders = ",".join("?" for _ in keep_ids)
            c.execute(
                f"DELETE FROM {table} WHERE rig_id = ? AND id NOT IN ({placeholders})",
                (rig_id, *keep_ids),
            )
        else:
            c.execute(f"DELETE FROM {table} WHERE rig_id = ?", (rig_id,))
        for order, (cid, cols, data) in enumerate(rows):
            names = ["id", "rig_id", *cols.keys(), "sort_order", "data"]
            values = [cid, rig_id, *cols.values(), order, data]
            updates = ", ".join(f"{n}=excluded.{n}" for n in names if n not in ("id", "rig_id"))
            c.execute(
                f"INSERT INTO {table}({', '.join(names)}) VALUES ({', '.join('?' for _ in names)}) "
                f"ON CONFLICT(rig_id, id) DO UPDATE SET {updates}",
                values,
            )

    def delete(self, rig_id: str) -> bool:
        with self.db.tx() as c:
            cur = c.execute("DELETE FROM rigs WHERE id = ?", (rig_id,))
            return cur.rowcount > 0


class ProfileRepository:
    def __init__(self, db: Database):
        self.db = db

    def list(self, query: str | None = None, category: str | None = None) -> list[DeviceProfile]:
        sql = "SELECT data FROM device_profiles"
        params: list[Any] = []
        clauses: list[str] = []
        if query:
            clauses.append("(LOWER(manufacturer || ' ' || model) LIKE ?)")
            params.append(f"%{query.lower()}%")
        if category:
            clauses.append("category = ?")
            params.append(category)
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY manufacturer, model"
        return [DeviceProfile.model_validate(json.loads(r["data"])) for r in self.db.conn.execute(sql, params)]

    def get(self, profile_id: str) -> DeviceProfile | None:
        row = self.db.conn.execute("SELECT data FROM device_profiles WHERE id = ?", (profile_id,)).fetchone()
        return DeviceProfile.model_validate(json.loads(row["data"])) if row else None

    def get_many(self, ids: list[str]) -> dict[str, DeviceProfile]:
        out: dict[str, DeviceProfile] = {}
        for pid in set(ids):
            p = self.get(pid)
            if p:
                out[pid] = p
        return out

    def save(self, profile: DeviceProfile, source: str) -> DeviceProfile:
        category = profile.category.value if isinstance(profile.category, DeviceCategory) else str(profile.category)
        with self.db.tx() as c:
            c.execute(
                "INSERT INTO device_profiles(id, source, manufacturer, model, category, data, updated_at) "
                "VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source=excluded.source, "
                "manufacturer=excluded.manufacturer, model=excluded.model, category=excluded.category, "
                "data=excluded.data, updated_at=excluded.updated_at",
                (profile.id, source, profile.manufacturer, profile.model, category, _dump(profile), utcnow_iso()),
            )
        return profile

    def source_of(self, profile_id: str) -> str | None:
        row = self.db.conn.execute("SELECT source FROM device_profiles WHERE id = ?", (profile_id,)).fetchone()
        return row["source"] if row else None

    def delete(self, profile_id: str) -> bool:
        with self.db.tx() as c:
            cur = c.execute("DELETE FROM device_profiles WHERE id = ?", (profile_id,))
            return cur.rowcount > 0

    def referenced_by(self, profile_id: str) -> list[str]:
        rows = self.db.conn.execute(
            "SELECT DISTINCT rig_id FROM device_instances WHERE profile_id = ?", (profile_id,)
        ).fetchall()
        return [r["rig_id"] for r in rows]
