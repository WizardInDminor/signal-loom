# Signal Loom

*Design the rig. Weave the signal.*

Signal Loom is a local-first workspace for designing, configuring and maintaining a guitar
effects rig as **one coherent system**: a dimensionally accurate pedalboard, typed physical
wiring (audio / MIDI / expression / power), reusable **scenes** that describe the desired rig
state, and a compiler that turns scenes into an inspectable Morningstar **MC8** switch plan and
**ML10X** routing plan. Nothing is ever sent to hardware; the app plans, validates and exports.

Session reports: [SESSION-1-RESULTS.md](SESSION-1-RESULTS.md) (foundation),
[SESSION-2-RESULTS.md](SESSION-2-RESULTS.md) (jack-aware wiring, stereo routing, Morningstar
tools, evidence levels and the hardware verification procedure) and
[SESSION-3-RESULTS.md](SESSION-3-RESULTS.md) (the Stage: a scene-first view of the physical rig). The domain model is described in
[ARCHITECTURE.md](ARCHITECTURE.md); research and licensing findings in
[docs/research.md](docs/research.md).

## Prerequisites

| Tool | Version used in Session 1 |
|---|---|
| Python | 3.11+ (3.13 tested) with [uv](https://docs.astral.sh/uv/) or plain `pip` |
| Node.js | 22.x (22.22 tested), npm 10 |
| Browser | any current desktop browser (Chromium used for the e2e suite) |

No accounts, cloud services, API keys or hardware are needed.

## Install

```bash
git clone https://github.com/WizardInDminor/signal-loom.git
cd signal-loom

# Backend (FastAPI + SQLite)
cd backend
uv venv .venv && uv pip install --python .venv/bin/python -e ".[dev]"
#   (or: python -m venv .venv && .venv/bin/pip install -e ".[dev]")
cd ..

# Frontend (Next.js)
cd frontend && npm ci && cd ..
```

## Run

Two processes, two terminals (or `scripts/dev.sh` which starts both):

```bash
# Terminal 1 — API on http://127.0.0.1:8000 (creates backend/data/signal_loom.sqlite3 on first run)
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

# Terminal 2 — UI on http://localhost:3000 (proxies /api/* to the backend)
cd frontend && npm run dev
```

Open <http://localhost:3000>. On a fresh database the backend applies its migrations, seeds the
hand-authored device catalog and creates two example rigs: the **mono demo** (ML10X + MC8 +
Plumes + Sunset + BigSky MX, three scenes) and the **stereo demo** (mono drives in ML10X loops
A/B, the BigSky MX as a stereo pair in loop C, Output Tip/Ring to two amps, Advanced presets). Set `SIGNAL_LOOM_DB=/path/to/file.sqlite3` to use another database
and `SIGNAL_LOOM_NO_DEMO=1` to skip the demo rig. API docs: <http://127.0.0.1:8000/docs>.

## Test, lint, build

```bash
# Backend: 64 unit/integration tests + lint
cd backend && .venv/bin/pytest -q && .venv/bin/ruff check app tests && .venv/bin/ruff format --check app tests

# Optional: fixture validation against real MC8 editor exports (downloads two public files,
# not redistributed here; the tests skip when the files are absent)
cd backend && scripts/fetch-fixtures.sh && .venv/bin/pytest -q tests/test_mc8_export.py

# Frontend: lint, typecheck, production build
cd frontend && npm run lint && npm run typecheck && npm run build

# Browser end-to-end (needs backend :8000 and frontend :3000 running)
cd frontend && npx playwright install chromium   # once; or set PW_CHROMIUM=/path/to/chrome
cd frontend && npm run test:e2e
```

GitHub Actions runs the same gates on every push (`.github/workflows/ci.yml`).

## Working with the board and the wiring (Session 2)

- **Cables start at real jacks.** On the Board tab, press on a jack dot and drag to another
  jack: only compatible targets light up (same signal kind, opposite direction, an input that
  has no plug yet). Drop to create the cable; it is validated like any other. The Wiring tab's
  diagram does the same with click-then-click. Cables can be shown on the board per signal kind.
- **Jack positions are editable graphically.** Select a device and drag its jacks on the
  outline in the inspector (stored on that instance as a user-specified position), or edit a
  profile's jacks in the Device library. The board, the wiring diagram, the cable kit and the
  manifest all use the same position.
- **Undo/redo** (buttons or Ctrl+Z / Ctrl+Shift+Z) covers every edit of the rig document.
  Devices snap to the grid and to the edges of their neighbours while dragging.
- **Stereo is traced per conductor.** The Wiring tab lists, for each ML10X preset, the left
  path (Input Tip … Output Tip) and the right path (e.g. the return-only loop that carries a
  stereo pedal's second output to Output Ring), with the physical Send/Return jack of every
  loop. The **cable kit** turns the connections into TS cables, TRS-to-dual-TS breakouts, DIN
  or TRS MIDI cables and DC leads.
- **Scenes to switches.** Duplicate a scene, then pick its MC8 bank/switch directly in the
  scene; switches already used by other scenes are disabled.
- **Morningstar tools** (Exports tab): import an MC8 "Current Bank" backup into the plan, and
  compare any two editor backups (MC8 or ML10X) field by field for controlled experiments.

## The Stage (Session 3)

Open a rig and pick **Stage** (or press ▶ Stage on a rig card; the URL fragment `#stage` deep
links to it). Pick a scene in the setlist, or step through it with the arrow keys as you would
on stage, and the board shows what the scene does physically:

- the **left and right conductors** flow along the real cables between the real jacks; routing
  inside the ML10X (the preset, not a cable) is drawn as dashed arcs inside its enclosure; a
  bypassed loop is faint, an empty loop is a dashed pass-through, a half-cabled loop ends the
  flow with “✕ breaks here”;
- every pedal shows the state the scene wants as an **LED** (lit = engaged, dark = bypassed,
  dashed = the scene does not say) and a line such as “loop bypassed · prog 1”; pedals the
  scene's path does not touch fade;
- the **MC8 face** lights the switch that recalls the scene (press a switch to jump to its
  scene); the scene's **MIDI messages** travel as pulses along the real MIDI cables, and a
  device no cable reaches is flagged on the board;
- “What happens” tells the scene in words, “What changes” lists the differences from the
  previous scene in the set (preset, paths, pedal states, programs, CCs, manual steps).

The Stage is read-only: it never edits the rig and never sends anything to hardware.

## A short tour: the three-scene demo

1. **Rigs** — open *Demo rig: three-scene song* (or create a new rig, optionally "from the demo").
2. **Board** — the ML10X, Plumes, Sunset, BigSky MX and MC8 are drawn at true scale on a
   600 × 300 mm board, with jack dots coloured by signal type. Drag a pedal, press **R** to
   rotate, nudge with the arrow keys. Overlaps and out-of-bounds placements are flagged; tick
   *Overlap is intentional* for deliberate stacking. The inspector shows which attributes of the
   profile are **unknown or estimated** and lets you add or move jacks on this instance.
3. **Wiring** — every physical cable, by signal kind, with validation (wrong direction, shared
   inputs, TRS-MIDI wiring, voltage/polarity/current, cycles, broken paths). The ML10X table
   shows which loop each pedal occupies, derived from the cables. Try removing *Plumes → Return A*:
   loop 1 is reported open regardless of any scene.
4. **Scenes** — *Clean intro*, *Heavy verse* and *Solo* describe the desired ML10X preset, loop
   states, pedal programs/bypass/CC values and manual steps. The right-hand panel is the
   compiled, ordered MIDI plan with a one-line explanation per message and diagnostics.
5. **Controllers** — MC8 bank 1 maps the scenes to switches A/B/C (message count vs the 16-slot
   limit shown per switch). ML10X presets are series loop chains validated against the cabling;
   firmware 1.1.2 vs 1.2.0 gates Advanced-mode behaviour.
6. **Exports** — wiring manifest (Markdown/CSV), scene & action report, MC8 switch map, the
   compiled plan JSON, the portable `.signal-loom.json` project file (re-importable from the Rigs
   page), and a Morningstar-editor-shaped **MC8 bank backup** whose evidence level is shown
   honestly (fixture-validated, not editor- or hardware-validated). ML10X native export is
   marked *blocked* with the reason.

## Repository layout

```
backend/   FastAPI app: models, SQLite repo + migrations, domain rules, compiler, exports, tests
frontend/  Next.js app: rig library, board, wiring, scenes, controllers, exports, device library
docs/      research notes (raw agent reports + consolidated research.md)
```

## Licensing of data

Every bundled device profile is hand-authored with a source URL and an evidence level.
No Pedal Playground records or images are vendored (the dataset has no license); a user-supplied
`pedals.json` can be imported from the Device library page. See `docs/research.md`.
