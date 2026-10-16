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

**Save ordering.** Every edit increments the document's `revision`. The store runs a
single-writer queue: at most one PUT is in flight, and when it returns the queue sends the
newest document again if a newer revision appeared meanwhile, so "Saved" is shown only once
the latest revision is confirmed. The server refuses a PUT whose revision is lower than the
stored one (`409 stale_revision`), which makes a late, out-of-order write harmless and tells a
second tab that the rig changed elsewhere. On page unload the newest document is flushed with
a keepalive request. Exports are computed server-side from the persisted rig, so the Exports
tab awaits a confirmed save before producing any file and blocks the download if saving fails.

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

## Stereo: conductors, paths and cables (Session 2)

The ML10X is modelled per **conductor**: each TRS jack contributes two ports (Tip, Ring)
sharing a `pair_group`, and each loop conductor is one of ten nodes `L1`..`L10`. A preset is
a directed graph over the nodes `IN_TIP`, `IN_RING`, `L1`..`L10`, `OUT_TIP`, `OUT_RING`
(a Simple chain is just `IN_TIP -> ... -> OUT_TIP`). `domain/paths.py` walks the graph from
each input and from every **return-only** loop (a loop with outgoing edges but none incoming,
the documented mono-send / stereo-return pattern) and labels each step with the device that
the cables put into that loop, its Send/Return jack, and whether the preset bypasses it. The
result is the "Left (Input Tip)" / "Right (…)" path list shown in the Wiring tab, the scene
editor and the manifest. Edges are checked per direction (`X -> Ln` needs Send n cabled,
`Ln -> Y` needs Return n cabled); an Output that no path reaches is an error.

`domain/cables.py` turns connections into the physical **cable kit**: both conductors of one
TRS jack in use → a TRS-to-dual-TS breakout; Tip only → a TS cable; Ring only → a breakout
with the Tip lead unused; MIDI DIN/TRS/adapter; DC leads. Every connection appears in exactly
one kit item.

## Document editing in the browser (Session 2)

The store keeps bounded undo/redo stacks of whole-document snapshots; applying one bumps the
revision like any edit so the save queue and the server's stale-revision rule stay in force.
Switching to another rig first drains the save queue; if the latest revision cannot be
saved, the switch is refused and the current document stays in memory with a blocking banner
(retry, or an explicit discard). `pendingCable` holds a half-made cable while the user drags from a jack; compatibility is
decided from the same `effective_ports` the backend uses, and the resulting connection is an
ordinary document edit.

## The Stage: a scene told on the physical board (Session 3)

The Stage is a pure projection of facts the rig already stores; it owns no state of its own
and never writes. Two backend additions make it possible without guessing in the browser:

- every traced `PathStep` names the switcher jack the conductor leaves through (`out_port_id`:
  a Send or the main Output), the jack it comes back in through (`in_port_id`: a Return or the
  main Input) and the physical cables plugged into them, in signal order (`cables`);
- `analysis.midi.routes` lists, for every device the MC8 reaches, the ordered MIDI cables
  (breadth-first, so the shortest physical route; MIDI Thru hops included).

`frontend/src/lib/stage.ts` turns a scene into a *story*: per conductor a list of segments
(`cable` = a connection id, `virtual` = the preset's hop inside the switcher, `device` = through
a pedal, each with a state: engaged / bypassed / empty / broken / return-only), per device the
state the scene wants (kept separate from the loop state, because an analog pedal's bypass is
its own footswitch), MIDI targets with their routes, the MC8 assignment, and a diff against the
previous scene in the set. `frontend/src/lib/boardLayout.ts` is the one place that turns rig
geometry into drawing coordinates and cable curves, shared by the Board and the Stage, so a
flow is drawn exactly on the cable the Board draws. Cables leave a jack perpendicular to the
edge the jack sits on (as a plug does); top-face jacks fall back to a bend towards the centre.

## Device pictures: assets, calibration and rendering (Session 3)

A photograph is a *visual layer* on a device whose geometry is already known; it never becomes
geometry. Three pieces keep that true:

- **Assets** (`app/assets.py`, table `assets`, migration 0003, files in the managed asset
  directory next to the database). An upload is sniffed by Pillow (JPEG/PNG/WebP only), checked
  against byte and pixel ceilings before decoding, EXIF-transposed, downscaled to 2048 px and
  re-encoded, so no original bytes or metadata are stored or served. Files are named by a
  server-generated `img_…` id; the API validates ids against a strict pattern before any lookup.
  Deleting an asset that a profile or rig still references is refused (409).
- **`DeviceImage`** (`models/profile.py`), on a profile or as an instance override: `asset_id`,
  a normalized `crop` in the stored image, `rotation_quarter` (quarter turns so the picture's top
  matches the device's top edge), `fit` (`contain` letterboxes, `cover` clips) and `calibrated`
  (true only when the selection was made against a known width and depth; a statement about the
  workflow, not about the measurements' evidence). `app/images.py::resolve_image` picks the
  effective picture (instance override wins) and joins it with the asset's pixel size; a missing
  asset resolves to `{missing: true}` and renderers fall back to the enclosure. The analysis
  exposes it per instance, the rig library preview per device.
- **Rendering** (`frontend/src/components/images/DeviceImageGlyph.tsx`): the picture is placed in
  the *unrotated* enclosure frame and rotated with the device about the same centre the jacks
  rotate about, so a 90° device shows a 90° picture with its jacks on the new edge. The crop is a
  nested SVG viewport (`viewBox` = crop in pixels) with `preserveAspectRatio` meet/slice, so
  nothing is ever stretched. Board, Stage and previews all use this one glyph under their own
  overlays (labels on a translucent chip, LEDs, paths, jacks).

Project files: format 1 is unchanged and carries only `DeviceImage` metadata; importing one on a
computer without the asset keeps the metadata and warns. `?include_images=1` produces a format 2
file with the assets base64-bundled; import restores them through the same sanitizer under the
same ids (local library still wins for existing profiles).

## Image-assisted jack mapping (Session 3)

Two coordinate systems, kept apart on purpose (`frontend/src/lib/jackMapping.ts`):

- **Image space**: `PortDef.image_anchor = {x, y, asset_id}`, a normalized point in the stored,
  orientation-corrected photograph. It records where the connector *appears* and may lie outside
  the enclosure crop. It is a visual annotation only: `placed_ports` never reads it. `asset_id`
  says which picture it was placed on, so a replaced photograph is flagged for reconciliation.
- **Enclosure space**: `PortDef.edge` + `position`, the wiring fact the board, the cable kit and
  the exports already use. The bridge from image to enclosure space is exactly the crop, the
  quarter turn and the fit mode the board uses to draw the picture (`imageToEnclosure` /
  `enclosureToImage`), so a marker and its lead agree with what the Board shows.

`suggestPlacement` proposes the edge (nearest edge within about 12 mm on a calibrated device,
the protruding side for a point outside the crop, `top_face` deep inside) and the normalized
position; the user can pin a different edge, and the position is then the projection of the
anchor on that edge. Nothing is invented beyond the click itself; positions set this way carry
`position_evidence = user`, connector facts `evidence = user` (hand-authored builtins keep
`evidence = None`, meaning "shares the profile's provenance").

Persistence goes through `PUT /api/catalog/devices/{id}/ports`, which replaces only the jack
list (dimensions, provenance, picture, MIDI and power data are untouched). Jack ids are stable
handles for cables: `ProfileRepository.port_usage` lists every cable, in every rig, plugged into
each jack, and the endpoint refuses (409 `ports_in_use`, affected cables listed, each with a
`change` of `"removed"` or the semantic diff) to drop an id a cable uses, or to change what a
used jack *is* (`kind`, `direction`, `connector`, `audio_channel`, `trs_role`, `midi_trs_type`,
`pair_group`, `role`; see `PORT_SEMANTIC_FIELDS`), unless `force` is set. Labels, positions,
anchors and clearance change freely, and filling in or un-stating a value is not a change. A
forced removal is then flagged by the existing `connection.port_missing` diagnostic and a forced
retype by `connection.kind_mismatch`/`connection.direction`, rather than any cable being deleted.
Saving jacks also calls `DeviceProfile.reconcile_declared_unknowns()`, which drops an importer's
"ports (not in dataset)" marker once the profile has jacks while leaving the power/MIDI unknowns
alone. TRS semantics are untouched: a stereo
TRS jack is one port with `audio_channel = stereo_trs`; an L/R pair is two ports sharing a
`pair_group`; per-conductor ML10X ports keep their `pair_group`/`loop` facts.

## Mounting surfaces and the underside (Session 3e, phase A)

A placed device has a **mounting surface**: `top`, `underside` or `off_board`
(`DeviceInstance.surface`). Rigs saved before this existed carry only `off_board`; they load with
`surface = None` and are read through `DeviceInstance.mount` (`off_board → off_board`, else
`top`). Loading never rewrites the flag; an explicit `surface` keeps the flag in agreement so
older readers see the same fact. The frontend mirrors this in `lib/mounting.ts` (`surfaceOf`).

Top and underside share one coordinate system and one perimeter. The underside view is the board
**seen through from above, not mirrored**: what is under your left foot is drawn on the left.
`geometry.board_diagnostics` bounds-checks both surfaces and reports collisions only between
devices on the same surface. Whether something fits *under* the board is a separate question
answered only from two documented figures: the device's `footprint.height` and the board's usable
clearance (`geometry.underside_clearance`: the user's `Board.underside_clearance_mm` wins, then
the catalog spec's figure, else unknown). Both known → `instance.underside_fits` (INFO) or
`instance.underside_too_tall` (ERROR); either missing → `instance.underside_height_unknown` /
`instance.underside_clearance_unverified` (WARNING). A footprint inside the perimeter is never
taken as proof. A board whose spec says `underside_mountable = False` refuses underside devices
(`instance.underside_unavailable`).

`models/board.py` / `catalog/boards.py` hold **pedalboard specs** (`GET /api/catalog/boards`):
overall size, height, rail count, rail pitch, underside mountability and clearance, open front,
bracket compatibility as text, each with evidence. Rails are drawn only when their pitch is known
(it never is, for the shipped Pedaltrain boards), so the underside view shows the frame outline,
the open front and the clearance status, and `board.underside_mounting_unverified` says bracket
fit is not checked. `Rig.board.model_id` points at a spec; the board's width/depth are copied in
when the user picks one and remain editable.

Mounting changes nothing electrically: wiring, MIDI, scenes and the Stage read the same
connections. On the Board a cable whose other end is on the other surface ends in a short stub
with ↧/↥; where it passes the board is not modelled and no length is invented. The wiring
manifest gains a *Mounted* column and notes cables that cross surfaces. Rig cards draw the top
surface only; the Stage dims underside devices.

## Power supplies and the power plan (Session 3e, phase B)

Outlet facts stay on the outlet's `PortDef`: `supply_voltage_v`, `supply_current_ma_max`,
`supply_polarity`, `supply_ac_dc`, `supply_isolated`, `supply_shared_group`, and for selectable
outlets `supply_options` (voltage → rating at that voltage). A jack that feeds another supply
(Strymon's 24 V Ojai link) is `role = "expansion_out"`. A device's need stays on its profile's
`PowerSpec`, now with `voltage_max_v` for a documented range (ML10X 9–18 V); `current_ma_min` is
the manufacturer's documented minimum requirement, not a measurement.

An **assignment is the typed power `Connection`** from outlet to inlet; there is no second
allocation model. The rig adds only `DeviceInstance.supply_settings` (outlet port id → chosen
voltage). `domain/power.py` derives everything else: `effective_outlet` applies the setting (an
option replaces voltage *and* rating; a value that is no option is reported invalid and the default
is used, never an invented capacity), `outlet_loads` sums the documented minimums per outlet, and
`power_plan` builds the planner view (`analysis.power`: supplies → outputs with assigned devices,
known requirement total, remaining, status derived from the wiring diagnostics; consumers;
`unpowered`; `unknown_requirements`). Capacities of separate outlets are never pooled.

`wiring._validate_power` extends the existing checks rather than replacing them: expansion link
used as an outlet (ERROR), invalid setting (ERROR), voltage outside the documented point or range
(ERROR), AC/DC mismatch (ERROR) or unknown (WARNING), polarity mismatch (ERROR, DC only) or unknown
(WARNING), rating below the documented minimum at the selected voltage (ERROR), and the unknowns
(`requirement_unknown`, `current_unknown`, `outlet_current_unknown`, `supply_unknown`) as
WARNINGs that never approve. `outlet_load_diagnostics` handles shared outlets: documented minimums
adding up beyond the rating (`power.outlet_overloaded`, ERROR), a total that cannot be known
(`power.outlet_load_unknown`), the lost isolation between devices on one outlet
(`power.outlet_shared_assumption`, INFO) and outlets documented as sharing a regulator
(`power.outlets_share_regulator`, INFO). `power.unpowered` is unchanged.

The **Power planner** (Wiring tab, `components/wiring/PowerPlanner.tsx`) shows one supply at a
time: each outlet's voltage (a select for selectable outlets, bound to `supply_settings`),
polarity, rating, the devices on it with their documented needs, the remaining current and a
status with the diagnostic codes in words. Assigning, moving and unplugging write power cables
through the store (`assignPower`, `unassignPower`, `setOutletVoltage`). Unpowered devices and
devices with no documented requirement are listed explicitly, and the footer repeats that the
figures are ratings and documented minimums, not measured draw.

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
- `mc8_export.py::bank_dump_to_plan` — imports an editor "Current Bank" file into the MC8 plan
  as explicit PC/CC messages (other message types are reported, not guessed).
- `backup_diff.py` — labelled structural diff of two editor backups (any model) for controlled
  experiments on the undecoded fields.

The core model never depends on these; a future adapter (another controller or switcher) adds
a module here and a compile target, not a change to scenes or wiring.
