# Signal Loom — Session 4 results: Live Rig Control

> Implementation branch `experiment/session-4-live-control`, started from `session-4-live-control`
> (the charter on top of merged Session 3 `main`). Draft PR against `main`; not merged.

## Baseline (before any edit)

| Check | Result |
|---|---|
| `backend: python -m pytest -q` | 106 passed, 4 skipped (external MC8/ML10X fixtures not downloaded) |
| `ruff check` / `ruff format --check` | clean |
| `npm run lint` / `typecheck` / `build` | clean |
| Playwright (production build, Chromium 1194, backend on a scratch DB) | 40 passed |

Toolchain in the sandbox: Python 3.13.16, Node 22.22, npm 10.9. `python-rtmidi` cannot be
installed here (no wheel builds; no MIDI hardware), which is exactly the CI condition the charter
asks for: everything below runs on the virtual transport.

## Execution plan (written before the edits)

1. **Workstation-local live bindings** (`models/live.py`, migration `0005_live_bindings.sql`,
   `live/bindings.py`): per rig, stored apart from the rig document and never exported.
2. **Transport protocol + virtual transport** (`live/transport.py`, `live/virtual.py`): PC/CC only,
   enumerable endpoints, a send log, simulated pedals attached to an endpoint's receiver network,
   an injectable virtual MC8 USB input. `live/rtmidi.py` is the optional real implementation
   (import-guarded; not exercisable in this sandbox).
3. **Route graph and coverage** (`vendors/*`, `live/routes.py`): computer → USB binding → device →
   MIDI cables, each hop with PC/CC/clock/SysEx-read capability, evidence and prerequisites;
   per-receiver-network channel collisions; one coverage row per device × message kind.
4. **Armed sender, monitor, service** (`live/sender.py`, `live/monitor.py`, `live/service.py`):
   disarmed at every start/disconnect/lost binding; dry run never touches the transport; ordered
   queue with a conservative delay, Stop, coalescing, toggle confirmation, forbidden-type rejection.
5. **API** (`api/live.py`): status, endpoints, bindings, coverage, connect/disconnect, arm/disarm,
   dry-run, audition, send, stop, log, panels, follower, virtual stomp injection; loopback-only.
6. **Backend tests** for every rule in charter §6; then the **Live tab** in the UI (coverage,
   bindings, arm, dry run vs audition, send log, generated panels, capture to scene through the
   existing store/revision pipeline, MC8 follower) and **Playwright** scenarios.
7. **Docs**: `docs/live-hardware-validation.md`, research evidence, ARCHITECTURE, README, this file.

P0a lands as one tested milestone before P1/P2 refinements.
