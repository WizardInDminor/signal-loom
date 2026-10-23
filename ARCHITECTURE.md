# Signal Loom — architecture and domain model

## Shape of the system

```
frontend (Next.js 16, React 19, TypeScript, zustand)
   └── /api/* rewritten to ──► backend (FastAPI, Pydantic v2, SQLite)
                                  ├── models/      hardware-independent domain types
                                  ├── repo.py      SQLite persistence (+ migrations/*.sql)
                                  ├── domain/      geometry · wiring · ml10x · compiler
                                  ├── morningstar/ specs (with evidence) · MC8 export · MC8/ML10X native bridge · ML10X reader
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

## Device manuals and the MIDI command library (Session 3f)

**Documents** (`app/documents.py`, table `documents`, migration 0004, files in the managed
document directory next to the database; `SIGNAL_LOOM_DOCS` overrides it). A PDF is a different
kind of thing from a photograph, so it does not share the image pipeline: the bytes are kept
byte-for-byte (a manual must stay citable by page) and only *validated* and *rendered*. Validation
is the `%PDF-` header, a `%%EOF` trailer in the last 8 KB, a 40 MB bound, and PDFium
(`pypdfium2`, a bundled local binary) opening the file and counting at most 2000 pages; the
client's content type is ignored. Ids are server-generated `doc_<12 hex>` and matched against a
strict pattern before any lookup, so no caller can name a path. Serving is passive by design:
`GET /api/documents/{id}/pages/{n}` rasterizes one page to PNG (cached under
`documents/cache/<id>/`), which is what the in-app viewer shows, so a PDF's scripts, links and
forms never execute in the browser; the original is only offered as `Content-Disposition:
attachment` with `nosniff`, a `default-src 'none'; sandbox` CSP and `no-store`. Text search is
local PDFium text extraction, cached per document; scanned PDFs report "no text layer". A profile
carries `documents: [DocumentRef{document_id, title, kind, note}]` and a command may cite
`{document_id, page}` (since Session 6 so may a documented control and a Quick Reference note); all
are found by a JSON `instr` search, so `referenced_by` sees attachments and citations alike. Replace keeps the id (citations survive) and is refused while another profile
shares the file; detach never deletes bytes unless asked and unreferenced; `DELETE
/api/documents/{id}` is refused while referenced. The API's `document_files` echo tells the UI
whether each referenced file is present on this computer, so an imported profile degrades to
"not on this computer" instead of a broken link.

**Commands** (`MidiCommand` in `models/profile.py`, `app/domain/commands.py`). A command is one CC
(`value_mode` fixed / choice / any) or one PC (wire number, optional bank MSB/LSB), with intent,
a tri-state `deterministic`, an evidence level, an optional citation and a separate
`verified_on_hardware` claim. It lives in `MidiSpec.commands` beside the documented
`cc_map`/`program_change`/`bypass`, which remain the *reference* the compiler checks numbers
against (`midi.cc_undocumented`, `midi.pc_out_of_range`, bank support) exactly as for hand-typed
values; `commands_from_midi_spec` derives starter commands from those facts copying their
evidence, so the two never contradict by construction and nothing is invented for a profile that
documents nothing. The MIDI channel is deliberately absent from a command: it is resolved from the
placed instance (override, else profile default) at compile time.

**Applied to scenes.** No new state shape: `CcValue` and `ProgramSelection` gained an optional
`AppliedCommand{command_id, name, definition, value_label, deterministic, applied_at}`. The numeric
fields beside it are still the compiler's only input; `definition` is `MidiCommand.fingerprint()`
(the wire-relevant fields as a canonical string, identical in `frontend/src/lib/commands.ts`) taken
at apply time. On every compile `_check_applied_command` compares it with the live command: equal →
nothing; different → `midi.command_changed` (warning, names old and new); gone →
`midi.command_removed`; toggle → `midi.command_toggle`; evidence unknown → `midi.command_unverified`.
Bytes change only when the user reapplies. `_check_cc_conflicts` collects every instruction for
one CC on one device in one scene (bypass-by-CC, Bank Select CCs, explicit values) and reports
different values as `scene.cc_conflict` (error) and repeats as `scene.cc_repeated` (info); nothing
is dropped or "corrected". The scene report names the command and the exact bytes and states that
it is not a record of device behaviour.

Project files: format 1 and 2 are unchanged and now carry `midi.commands`, `documents` references
and applied snapshots as ordinary profile/rig JSON; `?include_documents=1` produces a format 3 file
with the PDFs base64-bundled, restored on import through the same validation under the same ids.
Format 1 and 2 files cannot carry `documents`. The plain export still writes `assets: []` as it
always has, and omits the `documents` section entirely when empty, so older app versions keep
reading plain files.

## Structured control knowledge and Quick Reference notes (Session 6)

The documented CC map (`CcDef` in `MidiSpec.cc_map`) is the one place every consumer already reads
— the compiler's range and documentation checks, Session 5 eligibility, the Live panels, the Scene
picker's hints, `commands_from_midi_spec` — so Session 6 makes *it* the structured knowledge rather
than adding a parallel table. Every new field is optional with a "not stated" default, so existing
rows load unchanged and no SQL migration is needed (profiles and instances are validated JSON):

- `behavior` (`continuous · discrete · toggle · trigger · unknown`, None = not stated) is the richer
  form of the Session 5 `continuous` flag; a validator keeps the two in agreement (continuous ⇔ True,
  discrete/toggle/trigger ⇔ False, unknown ⇔ None). A legacy entry carrying only the flag gets the
  behaviour it implies; a client that only knows the flag and flips it wins over a behaviour that
  said no more than the flag (so a profile fetched and sent back by an older editor still saves);
  toggle/trigger plus `continuous = True` is a contradiction and is refused.
- `min_value` / `max_value` (documented range), `citation` (`SourceCitation`: document id, **PDF page
  index**, note — the same shape `MidiCommand.citation` always had, now shared), `mapping`
  (`manufacturer_default` or `user_configured` with the `factory_cc` the manual documents),
  `hardware_status` (`unverified · verified · failed`, with `hardware_note`; never set by the app),
  `review_status` (None/`reviewed`, or `proposed` for anything that came from automated extraction),
  `notes`.
- **Scope of `hardware_status` and `mapping`: the profile, deliberately.** A `CcDef` is model-level
  knowledge, so both are statements about every unit placed with that profile — exactly like
  `MidiCommand.verified_on_hardware` has been since Session 3f, and like jacks and pictures, where a
  unit that differs gets its own duplicated profile (the profile is the unit of configuration; the
  per-instance override seams are `port_overrides` and `image`, not MIDI). The editor shows the
  placed units sharing the profile (`control-usage.units`) before either is recorded and says to
  duplicate the profile for a unit that is remapped or was tested on its own; `hardware_note` is
  where the unit and date belong. A per-instance CC override (a remap on one unit only, with its
  own compiler, eligibility and picker resolution) is a separate seam not built in Session 6.
- **No connectivity inference.** Saving a control list never adds a MIDI interface: how MIDI reaches
  the pedal stays unknown until the user declares it (`midi-capability`, evidence `user`), and the
  workbench says so while scenes cannot yet address the pedal.
- `DeviceNote` (`id`, `title`, `body`, `category`, ordered `steps`, `references` as citations,
  `evidence`, `source_note`, `pinned`, timestamps) lives in `DeviceProfile.quick_reference` for the
  model and in `DeviceInstance.quick_reference` for one physical unit; the two are different facts
  and stored in different places on purpose.

Consequences, by construction rather than by duplication: `document_ids()` includes control
citations and note references, so `referenced_by`, the "present on this computer" echo, the
delete/detach refusals and the complete backup all see them; eligibility refuses a `proposed`
control (soft) and a toggle/trigger (hard, through `continuous = False`) and warns when a Texture
range leaves a documented range; the compiler adds `midi.cc_out_of_range` and `midi.cc_unreviewed`
(warnings; bytes unchanged); `commands_from_midi_spec` copies the control's citation and hardware
claim into the derived command and skips proposed controls. API: `PUT …/controls` (CC map only,
duplicate numbers refused, guarded while the performing rig uses the profile), `PUT
…/quick-reference` (timestamps kept for unchanged notes), `GET …/control-usage` (scene values and
Texture mappings per CC, for impact review), `GET /api/documents/{id}/pages/{n}/proposals` (regex
over the page's own text; proposals only, nothing written). `control-usage` returns `{controls,
units}`. Project files are unchanged in format:
`project_dict` omits Session 6 keys that hold their defaults (and a behaviour the legacy flag
already implies), so a plain export of a profile without new knowledge still opens in the previous
version, exactly as `textures` is handled. PDFium is not thread-safe: all PDFium work in
`app/documents.py` now runs under one re-entrant process-wide lock (two concurrent page renders
crashed the process before; `tests/test_pdf_concurrency.py` overlaps renders, text extraction and
proposals from eight threads and, with a fake PDFium, asserts that never more than one thread is
inside it).

**UI** (`frontend/src/components/workbench/*`, route `/catalog/[id]/workbench`): `Workbench` owns the
reading position (`ReferenceState`), so it survives every edit, and routes citations both ways (a
row turns the viewer to its page; the viewer cites its page into the open editor, or starts a
control or note from it); `SplitPane` is the resizable, keyboard-operable split that becomes two
segments below 1024 px with both panes kept mounted; `ControlsPane` / `NotesPane` edit one list each
and persist it whole with one PUT per committed edit; `ReferencePane` shows page pictures (the
previous page stays until the next has loaded, the next page is prefetched), find, zoom, the
explicit PDF-page footer, proposals and in-place upload. `lib/knowledge.ts` mirrors the model rules
and derives `continuous` from `behavior` before every save. `NotesPane` is reused in the Board
inspector for unit-level notes (an ordinary rig edit: undo, revision, debounced PUT).

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
`connections`, `scenes`, `assets` (pictures) and `documents` (PDF manuals). Core columns are relational; nested detail is the validated JSON of
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
- `mc8_native.py` (Session 7) — the bridge's three layers for MC8 files: `load_native` (file kept
  whole, hash and byte-exactness checked, unknown keys listed), `interpret_*` (every message,
  preset, bank and controller setting tagged with an evidence level; unsupported message types
  named from a third-party enum and preserved), `compare_bank_to_plan` (native bank vs the rig's
  compiled bank rendered through the validated writer) and `propose` (allow-listed edits, structural
  diff, self-checked `singleBank` output; everything else verbatim).
- `ml10x_native.py` (Session 7) — the same native/interpreted split for ML10X backups: hash check
  (algorithm reproduced on one real sample), controller/connector/preset interpretation, the routing
  matrix kept opaque with a labelled row observation, and `matrix_differential` for controlled export
  pairs. Still no writer.
- `app/api/morningstar.py` — stateless `/api/morningstar/*` endpoints (status, inspect with device
  auto-detection, mc8/compare, mc8/propose, ml10x/matrix-diff). Nothing is stored; the browser keeps
  the file text. UI: `frontend/src/components/morningstar/*`, route `/morningstar`,
  API/types in `frontend/src/lib/morningstar.ts`. See `docs/morningstar-bridge.md`.

The core model never depends on these; a future adapter (another controller or switcher) adds
a module here and a compile target, not a change to scenes or wiring.

## Live rig control: backend-owned MIDI, explicitly armed (Session 4)

The planner stays what it was: a scene is intent, the compiler turns it into bytes, nothing is
sent on load, on scene selection or on an edit. Session 4 adds an *optional* layer beside it:

```
backend/app/live/
  transport.py   Transport protocol; encode() is the one place bytes are built — PC and CC only,
                 every other status byte raises before any transport sees it; decode() for display
  virtual.py     simulation: endpoints, one receiver network per endpoint, stateful simulated pedals,
                 an injectable input, busy/unplug fault injection; records every byte string sent
  rtmidi.py      python-rtmidi implementation (optional extra ".[live]"; import-guarded; the sandbox
                 could not install it, so it is written against the API, not exercised)
  bindings.py    LiveBindings per rig in table live_bindings (migration 0005) — workstation-local,
                 never exported: OS endpoint names mean nothing on another computer
  routes.py      route graph: computer → bound endpoint → device jack → vendor forwarding → MIDI
                 cables → …; per hop, per kind (pc/cc/clock/sysex_read) a Capability with status,
                 evidence (published/unknown/simulation_tested/hardware_verified) and prerequisites
  sender.py      the only caller of transport.send: arm phrase, disarm on every change, ordered queue
                 with delay, Stop, coalescing, toggle confirmation, per-rig send log, "last sent"
  monitor.py     thread-safe inbox for incoming bytes; last-per-channel; the modest scene follower
  service.py     one per process on app.state.live: transports, world, endpoint states, resolution
                 of compiled messages to endpoints, panels, events
backend/app/vendors/   evidence-tagged route facts per family (Morningstar, Strymon, generic rules)
backend/app/api/live.py  loopback-only API (peer address and x-forwarded-for are both checked)
frontend/src/store/liveStore.ts, components/live/*   the Live tab; the browser never touches MIDI
```

**Ownership and locality.** FastAPI owns every port Signal Loom opens; the UI asks over HTTP and
polls `/api/live/events` for the send log, observations and simulated state. The API refuses any
client that is not loopback, including through the Next.js proxy (the forwarded address is checked),
so a browser on another machine can plan but cannot send.

**In-flight semantics and control priority (review follow-up).** The worker dequeues a message,
re-checks `armed` and hands the bytes to the transport inside one critical section. `disarm`,
`stop`, `attach_transport` (connect/disconnect/mode switch) and `close` announce themselves first
(`hold_worker`), so the worker yields to them between messages whatever the lock's fairness, then
take the same lock: none of them can return while a send is in flight, and no send can begin after
any of them has returned. The one message already handed to the driver completes and is logged as
sent; everything behind it is cancelled; the log says that transmitted messages are not undone.
`tests/test_live_race.py` forces this interleaving with a transport that blocks inside `send`, for
disarm, stop, disconnect, close, and through the service for disconnect, endpoint release and a
mode switch. `status()` exposes `in_flight`.

**Hot-plug detection is automatic.** While a rig is connected the service runs a watcher thread
(`check_endpoints`, every `SIGNAL_LOOM_LIVE_WATCH_S` seconds, default 1.0) that re-enumerates the
transport, closes and marks endpoints that vanished (disarming if armed), holds a binding whose
same-named port count changed, and re-opens endpoints that returned — without re-arming and
without resetting the simulated world (unlike the manual Rescan, which rebuilds it). It does not
depend on the Live tab, or any browser, being open. A check that cannot enumerate at all (a driver
error) **fails closed**: while armed, or with anything queued, the service disarms and drops the
queue, naming the cause in the log and in `status.last_check_error`; a later successful probe
rebinds what it finds but never re-arms.

**Acknowledged routes.** Each resolved message carries `needs_ack`: the route's hardware
prerequisites (Cross MIDI Thru, Omniport mode, a special cable, DC power) and, for an unverified
route, the undocumented hop by name. The sender refuses an audition or a panel send — before
anything is queued — until every item has been acknowledged in this connection session
(`409 live.confirm_route` lists them; the request's `acknowledge` echoes them back). A dry run
lists them as `confirmations_required`. Acknowledgements are forgotten on disconnect/reconnect.

**Endpoint identity on the real transport.** `rtmidi` ids are `rtmidi:<dir>:<name>#<k>`, `k` the
ordinal among same-named ports (Windows lists two identical devices under one name). A binding
records `peer_count` when saved; when the enumerated count differs, the port is held closed as
*ambiguous* (the position may be another device) and the session is disarmed until the user
re-saves the binding. `tests/test_live_rtmidi.py` exercises the adapter against a fake of the
python-rtmidi API (duplicates, busy, disappearance, input callbacks, the service on top of it).

**Disarmed by construction.** `LiveSender` starts disarmed and disarms itself on `attach_transport`
(connect, disconnect, mode switch), on a bindings change, when a bound endpoint disappears, on a
transport error mid-audition, and on shutdown. Arming requires the exact phrase and is never
restored: a backend restart, a reconnect or a rebind leaves the sender disarmed (tested). Dry run
is a pure function of resolved messages and cannot reach a transport (a test uses a transport whose
`send` raises). `stop()` cancels what is queued and says, in the log, that transmitted messages are
not undone. Toggle-type or otherwise state-dependent messages are refused until the caller confirms
them explicitly; the UI shows the list and asks.

**Routes and coverage.** A *binding* is "this enumerated endpoint is plugged into this device's
jack" (USB, or a MIDI input fed by a computer interface). From there the graph follows what the
vendor tables say the device repeats on which output (MC8 Cross MIDI Thru to DIN and Omniports;
ML10X hardware Thru of its 5-pin In; BigSky MX MIDI OUT when set to THRU) and the rig's ordinary
MIDI cables. A device's coverage for a kind is the weakest hop of its best route: **supported** only
when every hop is published; **unverified** when any hop is undocumented (ML10X USB → Thru, a
generic port marked `thru`, an unknown TRS wiring); **unsupported** when a hop rules it out (SysEx
over an Omniport, Sunset's firmware-only USB); **unreachable** with the smallest plausible change
when no bound endpoint arrives. The user can raise a hop to *hardware_verified* in the bindings
(their claim, recorded per workstation); the app never does.

**Collision scope** is one bound endpoint's receiver network — every device its messages can reach,
the entry device included (the MC8 listens on its own channel). Two pedals on channel 1 behind one
MC8 uplink are a `live.channel_collision` (warning); the same two pedals behind two separate USB
endpoints are not flagged; a declared `ChannelGroup` turns the warning into `live.channel_group`
(info) because broadcast is sometimes the point. The planner's older `midi.channel_shared` warning
is unchanged and still describes the MC8's own chain.

**The three state categories** are kept apart end to end: *last sent by Signal Loom* comes from the
sender's log; *observed reply* from the monitor (what arrived on an input on that channel; most
pedals send nothing); *simulated pedal* exists only in virtual mode and is labelled as such.
"Capture to scene" reads *last sent* only, shows the diff, and then performs an ordinary store
`update()` — same revision bump, same undo stack, same debounced PUT and stale-revision rule as any
edit. A panel change never rewrites a scene by itself, and selecting a scene never sends.

**Follower.** `LiveMonitor.follow` compares the last few seconds of observed messages with every
compiled scene: "possible" only when every message of exactly one scene was seen, "ambiguous" for
partial or multiple matches, otherwise "no evidence" — and the text says it does not prove which
footswitch was pressed or that any pedal changed. Whether the real MC8 echoes DIN/Omniport traffic
to USB at all is unknown and is step 7 of the hardware checklist.

**Virtual mode** is a first-class, user-selected simulation: endpoints are generated per rig (one
simulated USB per device whose profile lists USB MIDI, plus an input for controllers and a generic
interface), simulated pedals are attached to the receiver networks the route graph derives from the
bindings, channel-filtered, and keep program/bank/bypass/CC state. Selecting the real transport when
`python-rtmidi` is missing is refused with the reason; the simulation is never substituted silently.

## The whole-rig instrument: Textures and the performance engine (Session 5)

The planner and the Session 4 live layer are unchanged; Session 5 adds the first *musical* object
and a bounded way to play it.

```
backend/app/models/texture.py     Texture · Macro · Mapping · Lfo — authored intent on the rig document
backend/app/instrument/
  evaluator.py                    pure math: period, phase, triangle, effective macro, half-up scaling
  eligibility.py                  which CCs may be swept, and the provenance of that decision
  diagnostics.py                  texture.* review diagnostics and the analysis.textures report
backend/app/live/performance.py   PerformanceEngine: Clock, states, lease, budget, tick, Stop
backend/app/live/sender.py        + open_stream / stream_one / cancel_job / on_disarm hooks
backend/app/live/service.py       + texture_readiness, start/stop/heartbeat/params, "refuse while performing"
backend/app/api/live.py           + /rigs/{rig}/textures/{tex}/readiness|start, /perform/stop|heartbeat|params|status
frontend/src/lib/instrument.ts    evaluator mirror (animation only) and the function-role lens
frontend/src/store/instrumentStore.ts   controller id, heartbeat, readiness; owned by the rig page
frontend/src/components/instrument/*    the Instrument tab
```

**Data.** `Rig.textures` is an additive list (child table `textures`, migration 0006, keyed like
scenes). A `Texture` has a name, intent, notes, an optional `base_scene_id` (a reference, never a
recall), `tempo_bpm` (20–300), `function_roles` (instance id → drive / dynamics / pitch / modulation
/ delay / space / routing / other: an editable lens, not a signal-flow claim) and `macros`. A
`Macro` has a `base` in [0, 1], a `Lfo` (triangle only, `beats_per_cycle` 0.25–64, `depth` 0–1) and
`mappings`: `instance_id`, `cc`, `output_min`/`output_max` (0–127 each; min > max is the inverse
gesture), `enabled`, and the user's `user_override` with its mandatory `override_note`. Older rigs
load with zero textures; `project_dict` omits an empty `textures` key so a rig without textures
still opens in the previous app version; duplicate and import keep every id. A mapping whose device
or a texture whose scene is gone is kept verbatim and reported (`texture.instance_missing`,
`texture.scene_missing`); nothing is retargeted. Runtime state (phase, lease, counters, last
commanded value) lives in the engine only.

**Eligibility.** `CcDef.continuous` (None on every existing profile) is the documented statement
that a CC is a repeatable sweep; among shipped real profiles only BigSky MX CC 100 carries it. A CC
is eligible when it is documented continuous, synthetic (`provenance.source ==
"synthetic_fixture"`) or user-declared with a note — and never when it is CC 0/32, CC 120–127, the
bypass CC, a documented switch (bypass/engage/toggle/bank/mute/scroll/save…), documented as
discrete, or used by a named engage/bypass/toggle command. The physically verified Sunset CC 10/15
are bypass switches and are refused.

**Evaluator.** `period = beats × 60 / bpm`; `φ = ((t − t0)/period + φ0) mod 1`; triangle `l(0)=0`
rising, `l(¼)=1`, `l(½)=0`, `l(¾)=−1`; `e = clamp(b + d·l, 0, 1)` (LFO off → `e = b`); value
`clamp(floor(min + (max−min)·e + 0.5), 0, 127)`. NaN/∞ and out-of-bounds inputs raise. The TypeScript
mirror animates; the analysis and readiness reports carry the backend's numbers.

**Engine.** One `PerformanceEngine` per `LiveService`, idle and disarmed on every start. `start`
needs: rig connected, sender armed, no audition/panel message pending, no performance running, ≥1
enabled eligible mapping, every enabled mapping resolved to an open output endpoint with a
supported/unverified CC route and its prerequisites acknowledged (the Session 4 `live.confirm_route`
strings). Start returns a `controller_id`; heartbeats renew a 5 s lease; params (macro base, LFO
on/off/depth/division, BPM) need the controller id; Stop needs nothing. A tick every 100 ms
evaluates every destination, deduplicates unchanged values, hands at most two changed values to
`LiveSender.stream_one` (20 msg/s aggregate; one per destination per tick = 10/s each) and *defers*
the rest to the next tick (recomputed from the newest state, never queued; rotating start so no
destination starves). The sender coalesces per device/CC, so its queue never holds more than one
message per destination. Stop paths: Stop, lease expiry, any sender disarm (the sender calls the
engine's hook inside its disarm critical section), disconnect, mode/rig/bindings change, transport
error, shutdown. `stop()` cancels the performance's queued values, finishes its job (after which
`stream_one` refuses), waits for the one message in flight and joins the tick thread. While a
performance runs, scene auditions and panel sends are refused (`409 live.performing`). A tempo or
division change freezes the current phase as the new origin: no catch-up burst.

**UI.** The Instrument tab (first tab; Board stays the default for existing deep links) reads the
texture from the rig store and edits it like any document (undo, revision, debounced PUT). Connect
in virtual mode binds the simulated USB endpoints as part of the click (real ports are bound in
the Live tab only); arming is the Session 4 phrase; **Start performance** is a separate button. The
rig page owns the heartbeat so switching workspaces does not expire the lease; leaving the rig page
does. A second tab sees the performance, cannot start or steer it, and can Stop it. "Asked now" is
the browser's evaluation, "last commanded" the backend's; neither is pedal state.

**Post-review guard (finding 1) and destination uniqueness (finding 2).** While a performance of a
rig runs, the service refuses — under its own lock, through the rig PUT/DELETE, the MC8 bank import
and the catalog's MIDI/jack/command mutations — any change to that rig's device channels, profiles,
jacks, device set or cables, and any change to the performing texture's macros or mapping fields
(`409 live.performing_locked`; `backend/app/live/guard.py::rig_mutation_conflicts` is the pure
classifier). Macro base, LFO, tempo, descriptive fields, other textures, scenes, the MC8 plan and
geometry still save. Two enabled mappings addressing one device + CC, or two ready destinations
resolving to one endpoint + channel + CC, are reported (`texture.destination_conflict`, readiness
problems) and refuse Start; the engine refuses such a destination set as defense in depth, so the
per-destination budget and deduplication are per physical control.
