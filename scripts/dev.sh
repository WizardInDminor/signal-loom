#!/usr/bin/env bash
# Starts the backend (:8000) and the frontend (:3000) for local development.
set -euo pipefail
cd "$(dirname "$0")/.."
( cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000 ) &
BACK=$!
trap 'kill $BACK 2>/dev/null || true' EXIT
( cd frontend && npm run dev )
