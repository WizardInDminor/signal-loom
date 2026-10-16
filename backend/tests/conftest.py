from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.catalog.builtin import builtin_profiles
from app.catalog.demo import demo_rig
from app.main import create_app

EXTERNAL = Path(__file__).parent / "fixtures" / "external"


@pytest.fixture
def profiles():
    return {p.id: p for p in builtin_profiles()}


@pytest.fixture
def demo():
    return demo_rig()


@pytest.fixture
def db_path(tmp_path):
    return tmp_path / "test.sqlite3"


@pytest.fixture
def client(db_path):
    os.environ.pop("SIGNAL_LOOM_NO_DEMO", None)
    with TestClient(create_app(db_path)) as c:
        yield c


def external_fixture(name: str) -> Path | None:
    p = EXTERNAL / name
    return p if p.exists() else None
