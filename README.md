# Signal Loom

*Design the rig. Weave the signal.*

Signal Loom is a local-first workspace for designing, configuring and maintaining a guitar
effects rig as **one coherent system**: a dimensionally accurate pedalboard, typed physical
wiring (audio / MIDI / expression / power), reusable **scenes** that describe the desired rig
state, and a compiler that turns scenes into an inspectable Morningstar **MC8** switch plan and
**ML10X** routing plan. The planner never sends anything to hardware. Since Session 4 there is an
optional, explicitly armed **Live** layer: the backend owns the MIDI ports, you bind them once, see
which pedals each message kind really reaches, dry-run a scene, audition it while armed, dial in a
control and capture it back into the scene on purpose.

Session reports: [SESSION-1-RESULTS.md](SESSION-1-RESULTS.md) (foundation),
[SESSION-2-RESULTS.md](SESSION-2-RESULTS.md) (jack-aware wiring, stereo routing, Morningstar
tools, evidence levels and the hardware verification procedure) and
[SESSION-3-RESULTS.md](SESSION-3-RESULTS.md) (the Stage: a scene-first view of the physical rig) and
[SESSION-4-RESULTS.md](SESSION-4-RESULTS.md) (live rig control) and
[docs/midi-knowledge-workbench.md](docs/midi-knowledge-workbench.md) (Session 6: the MIDI Knowledge
Workbench, design and delivery). The domain model is described in
[ARCHITECTURE.md](ARCHITECTURE.md); research and licensing findings in
[docs/research.md](docs/research.md).

**Engineering process:** [CLAUDE.md](CLAUDE.md) is the onboarding entry point for new Claude Code sessions; [Engineering Operating Model](docs/engineering/OPERATING-MODEL.md) defines team boundaries, PR/CI gates and the software-to-hardware acceptance cadence. Use the [Engineering Handoff Template](docs/engineering/HANDOFF-TEMPLATE.md) for every substantive delivery. The [Verification Register](docs/verification-register.md) remains the single source of truth for what is actually tested.\n\nFuture product concepts (proposed, not implemented or scheduled) are tracked in
[docs/future-features.md](docs/future-features.md), starting with a deliberately isolated
**Experiment Mode** for capturing serendipitous multi-pedal combinations.

**Session 5 — the first playable whole-rig instrument** ([charter](SESSION-5-CHARTER.md),
[direction](SESSION-5-DIRECTION.md), [results](SESSION-5-RESULTS.md)) adds the **Instrument** tab: a
named **Texture** whose one macro moves documented continuous controls on several pedals through
independent ranges, with a tempo-related triangle LFO, previewed without any MIDI and performed only
through an explicit connect → arm → **Start** under a message budget and a browser lease. The
companion [Creative Instrument Vision](docs/creative-instrument-vision.md) captures the longer
musical direction (movements, transitions, Experiment Lab); those remain plans.


**Portable full backups:** The Exports tab also offers **Export complete backup (photos + PDFs)**, a
version-3 `.complete.signal-loom.json` bundle. It explicitly includes both asset categories and
refuses to download if referenced device profiles, pedal photos, or manuals are missing. The smaller
plain project export remains available for reference-only transfers. The new complete option does
not connect, arm, or send MIDI. The importer preserves original IDs for the files and validates
their bytes. Existing device profiles on a destination machine take precedence: to independently
verify full restoration of the exported profiles, use a fresh database/installation. Embedded
photographs and PDFs may be copyrighted—share only where permitted. Use an offline restore test
before treating one download as the sole recovery copy.

**Hardware and software verification:** [Living Verification Register](docs/verification-register.md) is
the continuously maintained index of physically verified, virtual-only, outstanding and deferred
test claims. The [Session 5 hardware acceptance procedure](docs/session-5-hardware-acceptance.md)
is the guided real-pedal checklist. Continuous cross-device modulation is **virtual/CI-verified,
not yet physically tested**; see the [dated Session 4 observations](docs/live-hardware-validation-2026-10-21.md).

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
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000 --timeout-keep-alive 75

# Terminal 2 — UI on http://localhost:3000 (proxies /api/* to the backend)
cd frontend && npm run dev
```

Open <http://localhost:3000>. On a fresh database the backend applies its migrations, seeds the
hand-authored device catalog and creates two example rigs: the **mono demo** (ML10X + MC8 +
Plumes + Sunset + BigSky MX, three scenes) and the **stereo demo** (mono drives in ML10X loops
A/B, the BigSky MX as a stereo pair in loop C, Output Tip/Ring to two amps, Advanced presets). Set `SIGNAL_LOOM_DB=/path/to/file.sqlite3` to use another database
and `SIGNAL_LOOM_NO_DEMO=1` to skip the demo rig. API docs: <http://127.0.0.1:8000/docs>.

The `--timeout-keep-alive 75` keeps the backend's idle connections open longer than the
frontend's proxy keeps them (about 4 s), so a reused connection is never closed by the server at
the moment it is reused; without it the browser occasionally sees a spurious "Internal Server
Error" from the proxy under load (CI, many tabs).

## Test, lint, build

```bash
# Backend: unit/integration tests + lint (the live layer runs on the virtual transport, no hardware)
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

## Play the rig as one instrument (Session 5)

Open a rig and pick **Instrument** (the first tab), or create a rig from the library with *Start
from the synthetic instrument demo*: that makes the **Undertow** rig — two Signal Loom *virtual*
pedals (synthetic, labelled so everywhere; not a real product) and a Texture whose **Bloom** macro
moves Pedal A's synthetic CC 21 from 100 down to 30 while Pedal B's CC 22 rises from 15 to 110, with
a slow triangle over eight beats at 72 BPM.

1. **What am I playing?** — name, musical intent, the Scene the idea starts from (a reference;
   selecting it sends nothing), the tempo (a reference for modulation; no MIDI Clock is sent), and
   the large macro with its LFO (cycle in beats, depth, phase readout). Everything here is saved
   with the rig like a scene: undo, autosave, export, duplicate, import.
2. **What does it move?** — the rig grouped by function (relabel any device per texture) and the
   patch list: macro → destination with its range and direction, the exact seven-bit values at
   macro 0 / ½ / 1, the live preview value, why the control may (or may not) be swept, its MIDI
   channel and route. Only controls a profile documents as *continuous* are offered as sweeps;
   anything else needs your explicit declaration with a note and is always marked as your claim.
   Bank select, channel-mode CCs and bypass/toggle controls are refused outright.
3. **What is happening?** — PREVIEW → DISARMED → ARMED → PERFORMING. Connect (virtual or real
   ports), arm with the Session 4 phrase, then press **Start performance**; **Stop** is always one
   click away and works from any tab. The stream is budgeted (20 messages/s in total, 10 per
   destination), deduplicated and lease-protected: the controlling tab heartbeats, and the backend
   stops the stream by itself a few seconds after that tab goes away. Any disarm (a lost port, a
   bindings change, a disconnect, a restart) stops it too. The counters show planned / handed /
   deduplicated / deferred, and each destination shows the value asked for now and the last value
   commanded — never "pedal state". A virtual performance is simulation, not hardware evidence.

When your real rig has no documented or declared continuous control on two different pedals, the
tab says so plainly and offers the synthetic demo instead of inventing one.

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
- **Fit and Expand.** The canvas area runs to the bottom of the window, and **Fit** picks the
  zoom from both its width and height (with a margin) so the whole board, off-board devices
  included, is on screen without scrolling; it keeps following window resizes until you move the
  zoom slider yourself, and pressing Fit again hands control back. **Expand** gives the board the
  whole window: zoom, Fit, undo/redo and the cable switches stay in the toolbar, the Add-device
  and inspector column can be hidden and shown, and Esc (or Exit) restores the normal layout.
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

## Pictures of your pedals (Session 3)

Open a profile in the **Device library** (or select a device on the Board and look at the
inspector) and press **Add picture…**. Upload a top-down JPEG, PNG or WebP photograph, then in
the crop editor draw a box around the enclosure, move it, resize it with the handles, and lock
it to the device's recorded width : depth. The preview on the right shows the result fitted
to the real footprint with the jacks in place; turn the picture in quarter steps if it was shot
sideways, and choose *fit inside* (margins in the enclosure colour) or *fill & clip* when the
box's proportions differ from the footprint. Nothing is ever stretched, and the text under the
preview says exactly how large the margins or the clipped share are. Save, and every board that
uses the profile shows the pedal at physical scale, on the Board, the Stage and the rig cards.
Recrop, Replace and Remove are one click; removing restores the plain enclosure drawing.

What stays true: the profile's footprint remains the source of truth for size (with its evidence
level); jacks, cables, collisions, measurements and plug clearance never depend on the picture;
rotating a device rotates the picture with it. A device without recorded dimensions can still be
cropped, but is labelled *not calibrated* until dimensions are entered and the picture recropped.
A placed unit can carry its own picture (a repainted pedal) that overrides the profile's.

Storage and rights: uploads are decoded defensively (only real JPEG/PNG/WebP; never SVG; 15 MB
and 40 megapixel limits), EXIF orientation is applied and then all metadata is stripped by
re-encoding, and the sanitized copy is kept under `backend/data/assets/` (or `$SIGNAL_LOOM_ASSETS`)
next to the database, named by id. Project files stay format 1 and carry only the crop metadata;
`GET /api/rigs/{id}/export?include_images=1` is the explicit opt-in that bundles the pictures
(format 2) for a backup or another computer. You are responsible for having the right to use any
photograph you upload; Signal Loom never downloads or redistributes product photography.

## Configure jacks by pointing at them (Session 3)

Imported catalogs (Pedal Playground) bring dimensions but no jacks. Once a profile has a
picture, press **Configure jacks on the photo** (Device library, or the Board inspector). The
whole photograph is shown, with the enclosure crop and its top edge drawn on it, so plugs that
stick out of the enclosure are still visible. Pick a starter template (mono, stereo, mono with
MIDI, or empty) or just click: each click on a connector places a marker and opens a compact
editor with sensible defaults (audio in, TS, mono). Change the type with one select, the audio
channel with one tap (mono · L · R · TRS L+R), drag markers to adjust, and save. Every board
that uses the profile gets the jacks; the per-unit jack editor and the table editor remain for
fine work.

What a marker is, and is not: it records where the connector *appears* in the photo. The cable
in the board model starts at the point the thin lead points to: the nearest enclosure edge (or
the side a plug protrudes from), or a top-face jack when the connector sits deep inside the
outline. Override the edge with the ▲ ▶ ▼ ◀ ◎ buttons if the guess is wrong. Positions and
connector facts you enter are stored with *user* evidence, separate from the catalog's
third-party dimensions. Markers are kept in photo coordinates, so recropping the picture never
moves a jack; a replaced photograph flags markers that were placed on the previous one.

The photograph sits centred in the mapping area with a margin on every side, so markers and
labels on a top-mounted row are never pressed against the edge; a small picture is scaled up to
the area, and zooming scrolls the whole picture including that margin.

Jack ids are stable handles for cables. Removing or renaming a jack that a cable in any of your
rigs uses, or changing what it is (an audio input becoming a MIDI input, an output becoming an
input, a different connector or channel), is refused with the list of affected cables until you
explicitly choose *Remove anyway* / *Change anyway*; the cables are then flagged by the wiring
check, never deleted silently. Labels, positions and photo markers change freely. Once an
imported pedal has its jacks mapped, the import's "ports (not in dataset)" note disappears from
its unknowns; power and MIDI stay marked unknown until you fill them in.

## Under the board, and the power to run it (Session 3)

**Top / Underside.** The Board has two surfaces that share one coordinate system. Switch with the
*Top* / *Underside* buttons: the underside is drawn seen through the board from above (not
mirrored), the other surface shows as faint ghosts, and *Add device* places on the surface you are
looking at. A device's *Mounted on* select (inspector) moves it between top, underside and
off-board. Pick a manufacturer pedalboard (Pedaltrain Classic 2, Novo 24) to take its dimensions;
the spec line says what is known (rail count) and what is not (rail spacing, usable clearance).
A device under the board is called a fit only when its documented height and the board's clearance
are both known; enter your own measurement in *Clearance under* to get a real answer, otherwise it
stays *unverified*. Cables that cross between surfaces end in a ↧/↥ stub; where they pass the
board is not modelled. Mounting changes nothing electrically: an underside Zuma powers pedals on
top, and an underside ML10X keeps its audio and MIDI in the Wiring and Stage workspaces.

**Power planner** (Wiring tab). Pick a supply (Strymon Zuma, Zuma R300 or the generic isolated
supply are built in); each outlet shows its voltage and polarity, its rating at the selected
voltage, the devices on it with their documented minimum requirements, the remaining current and
a status. Assign a device from the outlet row or from the *Not yet powered* list; move it with the
row's *move…* select; change a selectable outlet's voltage and watch its rating follow (Zuma out
8/9: 9 V/500 mA, 12 V/375 mA, 18 V/250 mA). Assignments are ordinary power cables, so the Wiring
diagnostics, cable kit and manifest agree with the planner. Errors: wrong voltage, wrong polarity,
AC/DC mismatch, an outlet rated below a device's documented minimum, a shared outlet whose
documented minimums add up past its rating, a pedal on the 24 V expansion link. Warnings: anything
not documented, which is never an approval. All currents are ratings and documented minimums, not
measured draw, and passing every check does not make an installation safe.

## Manuals and MIDI commands by name (Session 3)

**Documents.** On a device profile (Device library), *Upload PDF* attaches your own manual,
quick-start sheet or MIDI implementation chart. The file is checked by content (PDF header and
trailer, and PDFium must open it; a photograph renamed `.pdf` is refused), stored under an opaque
id in `backend/data/documents/` (or `$SIGNAL_LOOM_DOCS`), and the profile keeps only a title and a
reference. *View* opens the document at `/documents/<id>?page=N`: every page is a picture rendered
on your computer, so nothing inside the PDF can run in the app; *Find in document* searches the
PDF's own text layer (scanned manuals have none and say so). The original is only ever a download.
Rename and reclassify freely; *Replace* keeps the id so page citations stay valid (refused while
another profile shares the file, unless you confirm); detaching never deletes the file unless you
say so and nothing else uses it; *Documents on this computer* lists what is left. Signal Loom never
downloads a manual for you, and never bundles one in a project unless you choose *Export with
manuals*.

**MIDI commands.** Below the documented MIDI map, *MIDI commands* is your own library for the
profile: a name, a category, one CC (fixed value, documented value→meaning choices, or "any value
0–127") or one PC (wire number and optional bank; the device's displayed number follows the
profile's numbering), the intent (engage/bypass/set/toggle/recall), whether the result is
deterministic, where the numbers come from, an optional manual citation with page, and a separate
"I tried this on the device" claim. ★ marks favorites. *From documented map* turns the profile's
bypass CC, CC map and program-change support into starter commands with the map's own evidence.
A profile imported without MIDI data can hold commands, but scenes compile them only after you
*Declare MIDI input* (recorded as your statement, never as documented).

**In a scene.** Each MIDI pedal's row has *+ Command*: favorites first, search, the exact bytes
with the placed unit's channel ("CC 10 = 127 on channel 3 → Sunset"), the evidence, a link to the
cited manual page, a value choice where documented and a precise number for everything else, and
warnings for toggles, unknown sources, undocumented CCs and contradictions with what the scene
already says. *Add to scene* writes an ordinary CC value or program selection, compiled by the same
compiler and MC8 plan as before; typing numbers by hand still works. Under the value the row
remembers which command it came from. **Editing or deleting a command later never changes a saved
scene's bytes**: the row shows *definition changed — review* (or *command removed*), the compiled
plan carries a warning, and *reapply* is the deliberate act that updates it. Two different values
for one CC on one pedal in one scene are an error, never a silent choice.

## The MIDI Knowledge Workbench (Session 6)

Open a profile in the **Device library** and press **Knowledge Workbench** (or follow the link from a
placed pedal's inspector on the Board). The workbench is a two-pane workspace: the **Knowledge
Editor** on the left, the pedal's own PDFs on the right, with a draggable (and keyboard-operable)
divider; below 1024 px it becomes **Editor | Reference** segments that keep an open editor and the
reading position when you switch.

- **Controls** is the pedal's documented CC map as compact rows: number, name, behaviour
  (*continuous · discrete · toggle · trigger · unknown*), value range, evidence, the manual page it
  comes from, and your own hardware verification. Press **+ Control**, fill in what the chart says,
  and **Save & add another**: the next blank row opens with the same source page prefilled, so a
  MIDI implementation chart can be entered top to bottom while the page stays on screen. *Use the
  page open on the right* (or the viewer's *Cite p. N in the open control*) writes the citation;
  clicking a row's `p. 12` turns the viewer to that page. *On your hardware* holds the three facts
  the app never fills in for you: whether you tried the control on hardware (and on which unit,
  how, when), whether this number is the manufacturer's default or a remapped assignment (the
  factory number is kept), and your notes. Both are statements about the *profile*, so they apply to
  every unit placed with it; the editor lists those units, and a unit that is remapped or was tested
  on its own gets a duplicated profile, as for jacks and pictures. A list of controls never declares
  how MIDI reaches the pedal: *Declare MIDI input…* in the bar is the explicit statement, recorded as
  yours.
- **Quick Reference** is the practical knowledge about the pedal that is otherwise looked up again
  and again: how to save a preset, enter and leave a mode, set the MIDI channel, startup shortcuts,
  firmware procedures, fixes and discoveries. A note has a title, plain text, optional numbered
  steps, manual page references, provenance (manual / third-party / your own) and a pin. Pinned
  notes about the model also appear in the Board inspector of every placed unit; the inspector
  additionally takes notes about **this unit only** (its channel setting, a quirk), kept on the rig.
- **Reference**: document selection, page navigation (← → work when the page has focus), zoom,
  *Find* over the PDF's text layer, and an explicit **PDF page N of M · printed page numbers may
  differ** footer, because a citation is the PDF page index. *Suggest controls from text* reads
  "CC nn …" patterns from the current page; everything it finds is added as **proposed**, citing the
  page, and is not offered to Scenes or Textures until you check it and mark it reviewed. No
  manual attached yet? Upload one in place. A file that is missing on this computer says so and
  can be uploaded again under the same reference.

What this changes elsewhere: the Scene editor's **+ Command** picker now also lists the reviewed
documented controls (pick one, type a value inside its documented range, see the exact bytes);
the Texture destination picker labels each control's behaviour and marks proposals; the compiler
warns about a scene value outside a documented range or on an unreviewed control, without changing
any bytes; a toggle or trigger control is refused as a sweep like any other switch. Saved scenes
and textures never change when you edit a control (the editor shows where a number is used before
you renumber or remove it). Project files carry the controls, citations and notes as ordinary
profile and instance JSON, and *Export with manuals* / the complete backup bundles the cited PDFs.
Nothing in the workbench sends MIDI; *verified on my pedal* is only ever your statement.

## Live: audition a scene on the rig, safely (Session 4)

The **Live** tab is off until you make it do something. Five rules hold everywhere: the backend is
the only MIDI port owner (the browser never touches MIDI); it starts **disarmed** and disarms again on
disconnect, rebind, a lost port or a restart; a **dry run** never sends; only **PC and CC** can ever
be transmitted (no SysEx, no memory writes, no firmware); and the MC8 keeps working on its own —
nothing performance-critical runs through the computer.

1. **Transport.** *Virtual* is a simulation with stateful simulated pedals (what CI runs). *Real
   MIDI ports* needs `pip install -e ".[live]"` (python-rtmidi) on the computer cabled to the board;
   if it is missing the option says why, and the simulation is never substituted for it.
2. **Bindings.** Say which enumerated endpoint is plugged into which device jack (one USB cable to
   the MC8 is the reference setup; a powered hub with several pedals is the other). Bindings are
   saved for this computer only, never in a project file. *Suggest virtual bindings* does this for
   the simulation.
3. **Coverage.** One row per pedal × message kind: endpoint, hops, channel, status (route documented
   / unverified / unsupported / unreachable) with the evidence level, the prerequisites to check on
   the hardware (Cross MIDI Thru, Omniport mode, Strymon MIDI EXP cable…) and, for unreachable
   pedals, the smallest plausible change. Channel collisions are flagged per receiver network, and a
   deliberately shared channel can be declared.
4. **Audition.** Pick a scene, *Dry run* shows the exact bytes, order, endpoint and route status —
   the same compiled plan the Scenes tab shows. *Connect*, then *Arm…* (type `send MIDI to my rig`),
   then *Audition* transmits them in order with a conservative delay; *Stop* cancels what is queued
   (and says that transmitted messages are not undone). Before the first send over a route you
   confirm its hardware prerequisites and any unverified hop by name; toggle-type messages ask
   separately. While connected, the backend watches the ports and disarms by itself if one vanishes.
5. **Pedal panels.** Generated from each profile's documented PC range, bypass CC, CC map and named
   commands. Three columns stay apart: *last sent by Signal Loom*, *observed reply* (most pedals
   send none) and *simulated pedal* (virtual only). *Capture to scene…* shows what would change and
   then writes ordinary scene data through the normal save/undo pipeline.
6. **Controller observation.** What the MC8 sends to the computer, and at most a "possible active
   scene" when every compiled message of one scene was seen — never "which switch was pressed".

Before touching real pedals, read [docs/live-hardware-validation.md](docs/live-hardware-validation.md):
a reversible, step-by-step checklist that records what is documented, simulation-tested and
hardware-verified (by you). Nothing in this repository claims a hardware test that was not run.

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
backend/   FastAPI app: models, SQLite repo + migrations, domain rules, compiler, exports, tests;
           app/live (transports, bindings, routes, armed sender, monitor) and app/vendors (route evidence)
frontend/  Next.js app: rig library, board, stage, wiring, scenes, controllers, live, exports, device library
docs/      research notes (raw agent reports + consolidated research.md) and the hardware validation checklist
```

Local data that is never committed: `backend/data/` holds the SQLite database, the managed
picture directory (`assets/`) and the managed document directory (`documents/`).

## Licensing of data

Every bundled device profile is hand-authored with a source URL and an evidence level.
No Pedal Playground records or images are vendored (the dataset has no license); a user-supplied
`pedals.json` can be imported from the Device library page. See `docs/research.md`.
