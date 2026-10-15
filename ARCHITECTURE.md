# Signal Loom — architecture and domain model

## Shape of the system

```
frontend (Next.js 16, React 19, TypeScript, zustand)
   └── /api/* rewritten to ──► backend (FastAPI, Pydantic v2, SQLite)
                                  ├── models/      hardware-independent domain types
                                  ├── repo.py      SQLite persistence (+ migrations/*.sql)
                                  ├── domain/      geometry · wiring · ml10x · compiler
                                  ├── morningstar/ specs (with evidence) · MC8 export · ML10X reader
                                  ├── exports/     project file · Markdown/CSV package
                                  └── catalog/     hand-authored profiles · demo rig · PP importer
```

The UI holds **one rig document** in a store and saves it whole (`PUT /api/rigs/{id}`,
debounced). Every workspace (board, wiring, scenes, controllers, exports) is a view of that
same document, so moving a pedal on the board moves the same `DeviceInstance` the wiring
planner cables and the scene compiler addresses. Live feedback comes from
`POST /api/rigs/analyze`, which runs the full analysis on the unsaved document.

## Three layers, common ids

1. **Physical layout and ports** — `Board`, `DeviceInstance` (x/y/rotation, off-board flag,
   intentional-overlap flag, MIDI channel, per-instance port overrides) and `DeviceProfile`
   (definition). Geometry (`domain/geometry.py`) derives rotated footprints, absolute port
   coordinates and bounds/collision diagnostics.
2. **Physical connectivity and logical topology** — `Connection` is a *cable* between two
   `PortRef`s (`instance_id` + `port_id`). `domain/wiring.py` validates each cable against the
   port definitions and builds typed graphs. `domain/ml10x.py` derives **loop occupancy** (which
   device sits in which Tip/Ring loop) from cables and validates each virtual **preset path**
   against that occupancy.
3. **Scene intent and controller compilation** — `Scene` holds desired state (ML10X preset and
   loop states, per-device program/bypass/CC values, manual notes). `domain/compiler.py` turns
   a scene into an ordered `CompiledMessage` list with a source mapping and explanation, then
   lays the messages into the MC8 bank/switch plan under the MC8's documented limits.

All three reference the same stable ids: `inst_*` for instances, `conn_*` for cables,
`scene_*` for scenes, profile ids like `morningstar-ml10x`. Children are stored with a
`(rig_id, id)` key so a duplicated or imported rig keeps its ids.

## Definitions versus instances

`DeviceProfile` is the definition: manufacturer/model, footprint with per-measure evidence,
ports (label, kind, direction, connector, audio channel / TRS role / TRS-MIDI type, edge,
normalized position + evidence, plug clearance, role such as `loop_send`, loop number, supply
ratings for power outlets), power spec, MIDI spec (interfaces, default channel, PC range and
numbering convention, documented CC map, bypass command with on/off values and whether it is
deterministic), capabilities and declared unknowns. One profile can be placed many times.

`DeviceInstance` carries what is specific to a placement: position, rotation, label, MIDI
channel, `port_overrides` (add a jack, or override a profile jack by id) and `removed_port_ids`.
`effective_ports()` merges the two; every consumer (board, wiring, compiler, exports) uses it.

## Typed, directed graphs

`SignalKind` ∈ {audio, midi, expression, power, usb}. A cable is valid only if both ports share
the kind, the source is an output and the target an input, and exclusive inputs receive one
cable. Kind-specific rules add: stereo-TRS into mono (and vice versa), L/R crossing, TRS-MIDI
Type A/B mismatch or unknown wiring, DIN↔TRS adapters, voltage/polarity/current mismatches
(unknown values become warnings, never approvals), and passive splits/daisy chains.

The **audio graph** is a directed graph over instances; a switcher is split into an input
side and an output side so that `Send → pedal → Return` is a path rather than a false cycle.
Cycle detection, dead ends, missing sources, open loops (send cabled without return), loop
paths that do not close, and "no complete path from an instrument to an amp" are reported
independently of scenes — a disconnected cable cannot be fixed by a scene change.

**MIDI reachability** (controller → device, through hardware Thru ports) feeds the compiler so
that a scene targeting an uncabled device gets a warning.

## Scenes and the compiler

A scene is intent, not bytes. The compiler is deterministic for equal inputs (ordering is
defined by the rig's instance order and the scene's explicit fields) and never truncates:

- ML10X first: absolute bank select (`CC#0` = bank) then `PC` within the bank; then per-loop
  engage/bypass CCs (10–19) with explicit values, gated on the preset's mode and the assumed
  firmware (`morningstar/specs.py::ml10x_feature_gate`).
- Devices in rig order: Bank Select MSB/LSB (CC#0/#32) before PC, range-checked against the
  profile; bypass via the profile's documented CC with absolute on/off values (toggle-style
  bypass is flagged non-deterministic); extra CC values; manual steps for non-MIDI devices.
- MC8 plan: positions A–V (A–H page 1, I–P page 2, Q–V aux only), 30 banks, 16 messages per
  preset. Over-limit switches are errors; nothing is dropped silently.

Diagnostics carry a code, severity, message and subject so the UI can focus the offending
device/cable/switch.

## Persistence

SQLite with explicit SQL migrations (`backend/migrations/NNNN_name.sql`, applied once,
tracked in `schema_migrations`). Tables: `device_profiles`, `rigs`, `device_instances`,
`connections`, `scenes`. Core columns are relational; nested detail is the validated JSON of
the Pydantic model. Builtin profiles are re-seeded on start only if still marked `builtin`;
editing one in the UI turns it into a user-owned copy.

The **project file** (`format: signal-loom-project`, `format_version: 1`) embeds the rig and
every profile it references. Import is defensive (size limit, format/version check, full model
validation, no overwrite of existing library profiles, fresh rig id unless requested).

## Morningstar adapter boundary

`app/morningstar/` is the only place that knows vendor file formats:

- `specs.py` — constants with evidence annotations (counts, limits, CC numbers, codes).
- `mc8_export.py` — writes `singleBank` editor-backup JSON in the exact shape observed in real
  exports (key order, padded slots, type/action/toggle codes, Java-`hashCode` integrity hash)
  and reads/validates any MC8 backup. Only PC/CC messages are emitted; anything else is refused.
- `ml10x_backup.py` — read-only. The routing matrix of the ML10X backup is undecoded, so no
  writer exists on purpose.

The core model never depends on these; a future adapter (another controller or switcher) adds
a module here and a compile target, not a change to scenes or wiring.
