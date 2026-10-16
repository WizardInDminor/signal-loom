"""SQLite access and an explicit, file-based migration runner.

Migrations live in ``backend/migrations/NNNN_name.sql`` and are applied in order exactly
once; the applied set is recorded in ``schema_migrations``.
"""

from __future__ import annotations

import os
import sqlite3
import threading
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
    """One SQLite file, one connection per thread.

    FastAPI runs sync endpoints in a thread pool and the UI fires several requests at once,
    so a single shared connection would interleave cursors across threads. Each thread lazily
    opens its own connection (WAL mode lets readers and a writer coexist); ``close()`` closes
    them all. A file path is required: ``:memory:`` would give every thread a different DB.
    """

    def __init__(self, path: Path | str):
        self.path = Path(path)
        if str(self.path) == ":memory:":
            raise ValueError("Database needs a file path; per-thread connections cannot share :memory:")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._all: list[sqlite3.Connection] = []
        self._lock = threading.Lock()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.path), check_same_thread=False, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        return conn

    @property
    def conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = self._connect()
            self._local.conn = conn
            with self._lock:
                self._all.append(conn)
        return conn

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        conn = self.conn
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    def close(self) -> None:
        with self._lock:
            conns, self._all = self._all, []
        for c in conns:
            try:
                c.close()
            except sqlite3.ProgrammingError:
                pass  # closed from another thread already
        self._local = threading.local()

    # -- migrations -----------------------------------------------------------------
    def applied_versions(self) -> list[int]:
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)"
        )
        rows = self.conn.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
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
