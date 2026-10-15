"""SQLite access and an explicit, file-based migration runner.

Migrations live in ``backend/migrations/NNNN_name.sql`` and are applied in order exactly
once; the applied set is recorded in ``schema_migrations``.
"""

from __future__ import annotations

import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


def default_db_path() -> Path:
    env = os.environ.get("SIGNAL_LOOM_DB")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent / "data" / "signal_loom.sqlite3"


class Database:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        if str(self.path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.execute("PRAGMA journal_mode = WAL") if str(self.path) != ":memory:" else None

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        try:
            yield self._conn
            self._conn.commit()
        except Exception:
            self._conn.rollback()
            raise

    @property
    def conn(self) -> sqlite3.Connection:
        return self._conn

    def close(self) -> None:
        self._conn.close()

    # -- migrations -----------------------------------------------------------------
    def applied_versions(self) -> list[int]:
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)"
        )
        rows = self._conn.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
        return [r[0] for r in rows]

    def migrate(self) -> list[str]:
        applied = set(self.applied_versions())
        done: list[str] = []
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            version = int(path.name.split("_", 1)[0])
            if version in applied:
                continue
            sql = path.read_text(encoding="utf-8")
            with self.tx() as c:
                c.executescript(sql)
                c.execute(
                    "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, datetime('now'))",
                    (version, path.stem),
                )
            done.append(path.stem)
        return done
