"""Signal Loom backend. Run: uvicorn app.main:app --reload --port 8000"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import analysis as analysis_api
from .api import assets as assets_api
from .api import catalog as catalog_api
from .api import exports as exports_api
from .api import rigs as rigs_api
from .assets import AssetStore, default_assets_dir
from .catalog.builtin import builtin_profiles
from .catalog.demo import DEMO_RIG_ID, STEREO_DEMO_RIG_ID, demo_rig, stereo_demo_rig
from .db import Database, default_db_path
from .repo import ProfileRepository, RigRepository

APP_VERSION = "0.1.0"


def seed(db: Database) -> None:
    profiles = ProfileRepository(db)
    for p in builtin_profiles():
        if profiles.source_of(p.id) in (None, "builtin"):
            profiles.save(p, source="builtin")
    rigs = RigRepository(db)
    if not rigs.list() and os.environ.get("SIGNAL_LOOM_NO_DEMO") != "1":
        for rig in (demo_rig(), stereo_demo_rig()):
            if not rigs.exists(rig.id):
                rigs.save(rig, touch=False)
    elif (
        rigs.list()
        and not rigs.exists(STEREO_DEMO_RIG_ID)
        and os.environ.get("SIGNAL_LOOM_NO_DEMO") != "1"
        and rigs.exists(DEMO_RIG_ID)
    ):
        # Databases created by Session 1 get the stereo example too, once.
        rigs.save(stereo_demo_rig(), touch=False)


def create_app(db_path: Path | str | None = None) -> FastAPI:
    path = Path(db_path) if db_path else default_db_path()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db = Database(path)
        db.migrate()
        seed(db)
        app.state.db = db
        app.state.assets = AssetStore(db, default_assets_dir(path))
        yield
        db.close()

    app = FastAPI(title="Signal Loom", version=APP_VERSION, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(rigs_api.router)
    app.include_router(catalog_api.router)
    app.include_router(analysis_api.router)
    app.include_router(exports_api.router)
    app.include_router(assets_api.router)

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "version": APP_VERSION, "db": str(path)}

    return app


app = create_app()
