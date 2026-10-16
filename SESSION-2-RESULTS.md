# Session 2 results — Signal Loom

Branch `session-2-build`, 2026-10-16. Built autonomously from `SESSION-2-CHARTER.md` on top of
the reviewed Session 1 implementation.

## Base-branch dependency (charter §1.3)

At the start of Session 2, `main` contained only the two charter files; the reviewed Session 1
implementation (PR #1, with its review corrections: ordered revisioned saves, save-before-export,
full-rig export gating) was still an open draft on `session-1-build`. As instructed, Session 2
was **not** developed on the charter-only `main`: `session-2-build` branches from
`session-1-build` (d37b7a7) and merges the Session 2 charter from `main`. The Session 2 pull
request therefore targets `session-1-build`, so its diff is Session 2 work only. Merging PR #1
into `main` first, then this PR, yields the intended history. All Session 1 corrections are
present and covered by the existing tests (ordered saves, slow-save export, export gating).

## What changed and why

The defining question was whether a guitarist can plan, wire and configure a real stereo board
with an MC8 and ML10X and trust the app. Session 1 could represent such a rig but made the
user type connections into forms, treated the ML10X stereo case as a mono chain plus a label,
and offered no way to see *where* a left or right signal actually travels. Session 2 attacks
exactly those gaps.

### Jack-aware wiring on the board (charter §2)

- Cables are created by **dragging from a jack to a compatible jack** on the board (or
  click-then-click on the wiring diagram). Compatibility is decided from the same effective
  ports the backend validates: same signal kind, opposite direction, an input that has no plug
  yet. Incompatible drops do nothing visible beyond the dimmed targets; a cable from an input
  that already has a plug cannot even be started.
- Cables are drawn **between the actual jack positions** per signal kind (toggle per kind),
  bending towards the board centre so runs stay inside the drawing.
- Jack labels on the selected device and on drop targets; plug-clearance toggle; alignment
  guides that snap a dragged device to its neighbours' edges; placement measurements (width,
  depth, distance to the right edge); zoom-to-fit; off-board devices drawn apart.
- **Undo/redo** over the whole document (buttons and Ctrl+Z / Ctrl+Shift+Z). Snapshots go
  through the same revision/save queue, so nothing bypasses the Session 1 ordering guarantees.

### Graphical jack editor (charter §2, §4)

- Drag a jack along the outline of a device in the inspector; the result is stored as a
  per-instance override with evidence "user". Jacks with no documented position are drawn
  dashed until placed. The board, wiring diagram, cable kit and manifest read the same position
  (e2e asserts `estimated: false` and the new edge in the analysis after a drag).
- The same editor, plus a jack table, is available when editing or **duplicating** a profile
  in the Device library. Saving a copied/edited profile had been failing with 422 (the API's
  read-only echo fields were posted back); fixed and covered.

### Stereo routing and the ML10X (charter §3)

- The ML10X is modelled per conductor; presets are graphs over Input Tip/Ring, loops 1–10 and
  Output Tip/Ring. `domain/paths.py` traces every conductor and names, for each loop, the
  device the cables put there and its Send/Return jack, so the user can read the **left path**
  and the **right path** separately. Return-only loops (the documented mono-send /
  stereo-return pattern: a stereo pedal's second output comes back on the sibling Ring) are a
  first-class case; a Simple chain through such a loop is still an error.
- Advanced edges are validated **per direction** (into a loop needs its Send cabled, out of a
  loop needs its Return cabled), outputs that no path reaches are errors, and the firmware
  gate from Session 1 still refuses loop CCs on Advanced presets with an explanation.
- The **cable kit** lists the physical cables: TS, TRS-to-dual-TS breakouts (both conductors
  of one ML10X jack used), breakout with Tip unused (ring-only), DIN/TRS MIDI, adapters, DC.
  Stereo is no longer a label on a mono cable: the breakout is an explicit item with its Tip
  and Ring leads named.
- A **stereo demo rig** is seeded: Plumes and Sunset in loops A/B, BigSky MX as a stereo pair
  in loop C (mono send on Send C Tip, stereo return on Return C Tip/Ring), ML10X Output Tip/Ring
  to Amp L / Amp R, three Advanced presets on firmware 1.2, three scenes, MC8 bank 1 A/B/C.
  Its analysis has zero errors and compiles 6/7/7 messages per scene.

### Scenes and controller programming (charter §5)

- Duplicate a scene; assign a scene to an MC8 bank/switch **from the scene** (a switch used by
  another scene is disabled; assigning creates the bank if needed and seeds the short name).
- The chosen ML10X preset's left/right paths are shown inside the scene; program fields show
  the device's numbering convention ("shown as preset N on the device" / "PC n, zero-based")
  and flag unverified PC support.

### Morningstar interoperability (charter §6)

- **MC8 "Current Bank" import** (`POST /api/rigs/{id}/import/mc8-bank`, Exports tab): PC and CC
  messages become explicit messages on the MC8 plan with their channel, action and toggle
  position; other message types are reported as skipped, never guessed; bank-number collisions
  are handled (next free number, or `replace=1`). On the real public fixture every PC/CC slot
  round-trips byte-for-byte through the export. Evidence: **fixture-validated**.
- **Backup comparison tool** (`POST /api/rigs/inspect/backup-diff`, Exports tab) for MC8 and
  ML10X files: labelled paths (bank / preset / message slot / connector), scalar lists compared
  as one value (a 3-int routing entry), metadata differences listed. This is the instrument for
  the controlled experiments the ML10X routing field needs.
- **ML10X routing field**: analysed the only real backup available locally; three non-empty
  presets are far too little to decode `matrixArray`, and a third-party wire-format note
  indicates the JSON backup does not even contain the per-connector chain the device uses.
  Native ML10X export stays **blocked** and labelled so; the reader and the diff tool are the
  honest path forward (see `docs/research.md`).

### Reliability (charter §7)

Session 1 protections are intact and re-tested: ordered saves under a slow PUT, export after
an immediate edit, stale-revision refusal, export gating on any error-level diagnostic. New
in Session 2: undo/redo snapshots go through the same queue; importing an MC8 bank adopts the
server document without a page reload (and without dropping the result message); a stale
demo rig can no longer be mutated by tests (each test imports its own copy).

### Review follow-up (PR #2, 2026-10-16)

The owner's review found that `load()` cleared the current document even when `ensureSaved()`
reported a failed save, so switching rig URLs during a disk/server/validation fault could drop
unsaved edits. Fixed: a switch is refused while the current document cannot be saved; the
document stays in memory and on screen with a blocking banner offering *Retry save, then open
the other rig* or an explicit, confirmed *Discard*. Regression test: every PUT fails, an edit is
made, the user navigates to another rig; the banner appears, the edit is still unsaved on the
server; once the fault clears, Retry saves the first rig and opens the second (20th Playwright
scenario). Merge sequencing note: PR #2 targets `session-1-build`; after PR #1 lands in `main`,
retarget PR #2 to `main` and recheck before merging.

## User-facing capabilities added

| Where | Capability |
|---|---|
| Board | drag-to-connect between jacks, cable overlay per kind, jack labels, clearance toggle, snap-to-neighbour guides, measurements, Fit, undo/redo |
| Inspector | graphical jack editor (drag), rounded footprint display |
| Wiring | click-to-connect, signal paths per preset (L/R), cable kit |
| Scenes | duplicate, MC8 switch assignment, preset path summary, numbering hints |
| Device library | duplicate profile, category filter, jack table + graphical editor, read-only jack layout on profiles |
| Exports | MC8 bank import, backup comparison |
| Seed data | stereo demo rig |

## Tests performed and results

| Check | Result |
|---|---|
| `backend: pytest -q` | **64 passed** (14 new: stereo paths, return-only loops, per-direction edge checks, cable kit, ring-only breakout, stereo scene compile, stereo export/import, MC8 import round trip incl. the real fixture, collisions/replace, skipped types, backup diff + endpoint) |
| `ruff check` / `ruff format --check` | clean |
| `npm run lint` / `npm run typecheck` / `npm run build` | clean |
| Playwright, production build, Chromium | **20 passed** (12 Session 1 + 8 new: failing-save rig switch, drag-to-connect incl. incompatible drops, undo/redo + Ctrl+Z, jack editor drag reflected in analysis, stereo L/R paths + cable kit + breaking the right return, scene duplicate + switch assignment + compiled output + disabled taken switch, MC8 import + diff, catalog duplicate + jack drag + save) |
| Screenshot review of every workspace on the stereo demo | no console errors; cable routing and label staggering fixed after the first pass |

Bugs found and fixed during the session: profile save 422 (echo fields), import result lost on
reload, cable could start from a plugged input, cable curves drawn outside the board, jack
labels overlapping on crowded edges, float noise in inch-converted footprints.

## Regressions or unresolved defects

- None known. All Session 1 scenarios pass unchanged.
- Drag interactions are tested with a mouse pointer; touch/pen are untested.
- The jack editor places `top_face` jacks at mid-depth and moves them to an edge when dragged;
  a true top-panel position is not modelled.

## Morningstar interoperability status

| Output | Level | Note |
|---|---|---|
| Signal Loom project file | fixture-validated | round-trip tests incl. the stereo rig |
| Human-readable package (manifest with paths + cable kit, scene report, switch map) | n/a | |
| MC8 bank backup export | **fixture-validated** | unchanged: shape + hash from real exports; not editor/hardware-validated |
| MC8 bank backup import | **fixture-validated** | PC/CC round trip on the real public fixture |
| Backup comparison | n/a | pure structural diff |
| ML10X native export | **blocked** | routing field undecoded; reader + diff tool only |

## Deliberately deferred

- Advanced-mode graph *editor* (edges are typed as text; validated and traced, not drawn).
- Touch/pen drag, multi-select, group move, rotation handles on the canvas.
- Importing MC8 expression presets, bank messages and non-PC/CC message types.
- A decoder for the ML10X routing field (needs controlled export pairs from the user).
- Setlist mode, bill of materials with part numbers, image overlays.

## Recommended next steps with the real pedalboard

1. **Confirm the stereo wiring physically** with the stereo demo as the template: mono send on
   Send C (Tip) → BigSky In L; BigSky Out L/R → Return C via a TRS-to-dual-TS breakout
   (Tip lead = L, Ring lead = R); Output via a breakout to the two amps. The cable kit lists
   exactly these cables.
2. **ML10X Advanced preset:** in the Morningstar editor, build preset 1 as the app shows it
   (Input Tip → A Tip → B Tip → C Tip → Output Tip; C Ring → Output Ring) and verify the right
   channel reaches Amp R. Please note whether the editor lets a loop be used return-only without
   any input connection; that confirms the modelled pattern on your firmware.
3. **Controlled ML10X export pair:** export a Device Backup, change one loop in one preset,
   export again, and run both through *Compare two editor backups*. Share the diff (it contains
   preset names and routing numbers only); two or three such pairs are enough to start decoding
   the routing field.
4. **MC8 round trip:** Controller Backup → Current Bank of a bank you already use; import it in
   Signal Loom (Exports tab), check the Controllers tab shows your switches and messages, export
   the bank from Signal Loom and compare both files with the diff tool (expect differences only
   in `downloadDate`/`hash`/`description` and in non-PC/CC slots the importer skipped).
5. Keep following the Session 1 procedure before any restore to the controller: All-Banks backup
   first, restore into an unused bank, inspect in the editor, never auto-upload.
