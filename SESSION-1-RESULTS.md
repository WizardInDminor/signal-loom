# Session 1 results — Signal Loom

Branch `session-1-build`, 2026-10-15. Built autonomously from `SESSION-1-CHARTER.md`.

## What was built

A working local-first rig design application:

- **Backend** (FastAPI + Pydantic v2 + SQLite, `backend/`): device profiles vs instances,
  typed ports, rig document with board / cables / scenes / MC8 + ML10X plans; SQL migrations;
  geometry (rotation-aware footprints, port coordinates, bounds and collisions); typed wiring
  validation across audio / MIDI / expression / power; audio-graph cycles, dead ends, open
  switcher loops and broken instrument→amp paths; ML10X loop occupancy derived from cables and
  preset-vs-cabling validation; a deterministic scene → PC/CC compiler with explanations and
  diagnostics; MC8 bank/switch plan with documented limits; exports (project file, wiring
  manifest MD/CSV, scene report, switch map MD/CSV/JSON, MC8 editor bank-backup JSON);
  read-only MC8 and ML10X backup inspectors; hand-authored catalog + Pedal Playground importer.
- **Frontend** (Next.js 16 / React 19 / TypeScript, `frontend/`): rig library; true-scale
  board designer with drag/snap/rotate, keyboard nudging, off-board devices, port dots with
  estimated-position styling and plug clearance, per-instance jack editor; wiring workspace
  with typed cable form, cable metadata, signal diagram, loop table and live diagnostics;
  scene editor with the compiled plan side by side; controllers workspace (MC8 grid with
  message counts/limits, ML10X preset chains with firmware gate); exports with explicit
  evidence levels; device library with provenance display and custom profiles.
- **Docs**: `README.md`, `ARCHITECTURE.md`, `docs/research.md` (+ raw notes), this file.
- **Quality gates**: 47 pytest tests, 9 Playwright scenarios, ruff, eslint, tsc, `next build`,
  GitHub Actions workflow running all of them.

## Verification evidence (from this session)

| Check | Result |
|---|---|
| `backend: pytest -q` | 47 passed (includes fixture round-trip tests against real MC8 editor exports downloaded locally; those two tests skip in CI unless `scripts/fetch-fixtures.sh` is run) |
| `backend: ruff check` / `ruff format --check` | clean |
| `frontend: npm run lint` / `npm run typecheck` / `npm run build` | clean; build produces `/`, `/catalog`, `/rigs/[id]` |
| `frontend: npm run test:e2e` (backend :8000 + frontend :3000, Chromium) | 9 passed |
| Manual browser pass (screenshots of every workspace) | all five workspaces render the demo rig without console errors |
| MC8 export self-check against real files | all three public exports parse, 30/1/1 banks, `hash` reproduced, byte-identical re-serialization |
| ML10X backup reader against a real file (local only, GPL-licensed source, not committed) | 14 connectors, 512 presets read; routing field left undecoded |

## Acceptance tests (charter §8) — status

Legend: **verified** (automated or directly observed), **implemented-unverified**, **blocked**, **deferred**.

| # | Test | Status | Evidence |
|---|---|---|---|
| 1 | Cold start from README | **verified** | fresh DB → migrations + catalog + demo rig (`test_cold_start_seeds_catalog_and_demo`, `test_migrations_are_idempotent`); README install/run steps are what this session used |
| 2 | Rig persistence, restart, export/import compare | **verified** | `test_rig_survives_backend_restart_with_same_ids` (new app instance on same file, ids and edited x/rotation unchanged), `test_export_import_round_trip_preserves_content` (normalized compare), e2e "change persists after reload" |
| 3 | True scale and rotation, bounds/overlap feedback | **verified** | `test_footprint_is_proportional_to_documented_dimensions`, `test_rotation_swaps_bounding_box_and_moves_ports` (port coordinates checked for 0/90/180), `test_out_of_bounds_and_collision_feedback`; e2e collision/intentional/out-of-bounds |
| 4 | Port editing + same instance across workspaces + incompatible connection flagged | **verified** | `test_custom_port_persists_and_is_same_instance_everywhere` (jack added on an instance appears in board geometry of that id, cable validates, wrong direction flagged), `test_incompatible_signal_domains_are_rejected`; e2e "build a small rig" adds a jack through the UI |
| 5 | Wiring integrity with ML10X; removing a cable breaks the path independent of scene | **verified** | `test_demo_rig_is_coherent`, `test_removing_one_cable_breaks_loop_independent_of_scene`, `test_removing_output_cable_breaks_guitar_to_amp_path`; e2e removes and re-adds *Plumes → Return A* |
| 6 | Three-scene workflow, save/reload, assign to ≥3 MC8 switches | **verified** | demo scenes Clean intro / Heavy verse / Solo with distinct ML10X presets and pedal programs; bank 1 A/B/C; `test_three_scenes_compile_to_inspectable_messages`; e2e scenes + controllers |
| 7 | Compiler: deterministic, inspectable, fails clearly on invalid input | **verified** | `test_recompile_is_deterministic` (including reordered inputs), `test_invalid_channel_and_values_fail_clearly`, `test_pc_out_of_documented_range_is_an_error`, `test_switch_message_limit_is_enforced_not_truncated` (22 messages → error, none dropped) |
| 8 | Unknowns communicated, not fabricated | **verified** | Plumes ships with unknown jack positions and unknown jack inclusion; `test_unknown_port_positions_are_estimates_not_facts`; power unknowns are warnings (`test_power_validation`); UI shows "unknown/estimated" badges (e2e asserts the Plumes badge) |
| 9 | Deliverables: wiring manifest, action map, project import; native export only at claimed level | **verified** for the human-readable package and project file; **MC8 native = fixture-validated** (shape + hash from real files; never loaded in the editor); **ML10X native = blocked** and labelled unavailable in the UI with the reason |
| 10 | Usability through the interface | **verified** for the demo path (9 e2e scenarios incl. building a rig from scratch, keyboard-accessible controls, visible selection, error banners). Not user-tested by a human yet |
| 11 | Quality gates | **verified** locally; CI workflow added but **not yet observed green on GitHub** (first run happens on push) |

## Charter requirements — requirement-by-requirement

| Area | Status | Notes |
|---|---|---|
| A. Rig library (create/open/rename/duplicate/delete with confirmation) | verified | e2e + API tests |
| A. Device catalog + custom device editor | verified | form + JSON editor; builtin edits become user copies |
| A. Pedal Playground research/licensing | verified | no license → not vendored; importer + attribution recorded |
| A. Jack position editor (per instance, estimates labelled) | verified | `PortEditor`, evidence shown per port |
| A. Named device profiles without invented specs | verified | every attribute has an evidence level; official pages could only be seen via search excerpts (see research.md) |
| B. Board designer (scale, move, rotate, select, edit, remove, grid/snap/zoom, bounds, overlap, ports, clearance) | verified | SVG canvas; clearance drawn where known |
| C. Wiring editor with typed validation, mono/stereo/TRS distinctions, cable metadata, cycles, unterminated routes, intentional flag, power warnings | verified | `domain/wiring.py`, 9 wiring tests |
| C. ML10X as concrete switching device, loop mapping, simple vs advanced | verified / partly unverified | Simple-mode chains fully modelled and validated; Advanced presets modelled as edge lists for validation only (editor-authored); 1.2 behaviour feature-gated |
| D. Scenes, ordered song view, desired vs compiled side by side | verified | scene list with ordering; compiled plan panel |
| D. PC/CC reliability, ranges, zero/one-based, limits, absolute vs toggle | verified | compiler tests |
| E. MC8 planning (banks, positions, labels, actions, limits) | verified | original MC8 limits only; Pro values absent |
| E. ML10X topology distinct from cables and MIDI | verified | `loop_occupancy` vs `preset_path` vs compiler |
| E. Export 1 — project round trip | verified | |
| E. Export 2 — human-readable package | verified | MD/CSV/JSON |
| E. Export 3 — MC8 native | implemented, **fixture-validated** | see research.md §3 |
| E. Export 4 — ML10X native | **blocked** | routing field undecoded, hash unverified; reader only |
| E. Export 5 — intermediate spec + editor mapping + blocker report | verified | scene report + switch map + research.md |
| E. Export 6 — never auto-upload; safe verification procedure | verified | no MIDI/USB code at all; procedure in research.md §5 |
| §5 research document with evidence levels | verified | `docs/research.md` |
| §9 README / architecture / research / tests / CI / results | verified | this file |

## What remains unverified or blocked (honest list)

1. **Vendor pages were unreachable from the sandbox.** Every "documented" fact came through
   search-engine excerpts of the official pages or official GitHub repos. They are internally
   consistent and cross-checked against real export files, but a browser confirmation pass is
   the first thing to do (list in `docs/research/raw-*.md`).
2. **MC8 bank backup is fixture-validated only.** Not loaded into the Morningstar editor, not
   restored to an MC8. Unknowns: whether the editor validates `hash`; official name-length
   limits; `tg` default for scene presets (we use "Both" = 2, the observed default).
3. **ML10X native export is blocked** (undecoded `matrixArray`, unverified hash). The
   per-loop CC behaviour of Advanced presets on firmware 1.2 is unverified and therefore
   disabled with an explanatory error.
4. **Device specs with third-party-only evidence**: Sunset dimensions, BigSky MX bypass CC 102
   and bank mapping (BigSky family, not the MX manual), Plumes jack list. All flagged in the UI.
5. **No human usability test** beyond the automated browser path and screenshot review.
6. **CI**: the first run exposed a real bug (one SQLite connection shared across the request
   thread pool caused intermittent 500s under the UI's parallel requests); fixed with
   per-thread connections and a regression test. Green status is tracked on the PR.
7. Deferred (P2/P3): Advanced-mode graph editor, cable bill of materials beyond the manifest,
   setlist mode, image overlays, MC8 expression presets / bank messages / non-PC-CC message
   types, allBanks export, live MIDI.

## How to validate with the user's MC8 and ML10X (safe procedure)

1. Back up first: Morningstar editor → Controller Backup → **All Banks** for the MC8; ML10X
   editor → Device Backup. Keep both files.
2. In Signal Loom, open the demo rig → Exports → *Prepare bank 1* → download the
   `Morningstar_MC8_Bank_Backup_…json`.
3. In the MC8 editor, select an **unused bank**, Controller Backup → Restore → choose the
   downloaded file. Do **not** save to the controller yet. Inspect switches A/B/C: names
   Clean/Heavy/Solo, messages matching the Scenes tab (CC#0 bank → PC on ch 10 for the ML10X,
   PC + CC#10 on ch 3 for Sunset, CC#0 + PC + CC#102 on ch 2 for BigSky). Report any
   difference; that moves the MC8 export to *editor-validated*.
4. Only then save the bank to the controller, connect a MIDI monitor to the MC8 Out and
   compare presses against `…-mc8-switch-map.csv`; that moves it to *hardware-validated*.
5. Load the ML10X Device Backup into Signal Loom's inspector (Exports tab) — read-only — and
   optionally create two presets differing by one loop and export again so the routing field
   can be decoded in Session 2.
6. Restore your All-Banks backup when done.

## Highest-leverage next steps

1. Confirm the "documented (snippet)" facts in a browser and correct `specs.py` / `builtin.py`.
2. Editor-validate the MC8 bank export with the procedure above; add an empty-bank official
   export as a committed fixture **if** its license allows (ask the user to supply one).
3. Decode the ML10X `matrixArray` from paired backups; only then consider an ML10X writer.
4. Stereo-aware demo variant (BigSky L/R on C Tip/Ring + Advanced-mode preset) once the
   Advanced-mode summing rules are confirmed verbatim.
5. UX polish: diagram edge routing, drag-to-connect on the wiring diagram, undo, bill of
   materials.
