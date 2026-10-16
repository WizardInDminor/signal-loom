# Session 3 results — the Stage

Branch `experiment/session-3-freestyle`, 2026-10-16, built autonomously from
`SESSION-3-FREESTYLE.md` on top of `main` at e3e90ac (Sessions 1 + 2 merged). Direction chosen
and recorded first in `SESSION-3-DIRECTION.md`; this document is the reflection.

## The thesis, in one sentence

Signal Loom knew more about a rig than it showed: Session 3 adds a **Stage** where picking a
scene makes the physical pedalboard tell what the scene does, instead of the user reading it off
four tables.

## What changed

### The Stage (new workspace, deep-linkable as `#stage`)

Pick a scene in the setlist, step through it with the arrow keys, press a switch on the drawn MC8
face, or hit Replay. The board then shows, for that scene:

| On the board | Derived from |
|---|---|
| **Left and right conductor flows** animated along the real cables between the real jacks; preset hops inside the ML10X drawn as dashed arcs *inside* its enclosure; bypassed loops faint; empty loops a dashed pass-through; a half-cabled loop ends the flow with “✕ breaks here” | traced paths (`out_port_id`, `in_port_id`, `cables` per step, new in this session), the rig's connections, the preset's bypassed loops, Simple-preset per-loop overrides from the scene |
| **Pedal LEDs**: lit = the scene wants it engaged, dark = bypassed, dashed = the scene does not say; a state line (“loop bypassed · prog 1”); pedals outside the scene's path fade | `scene.device_states`, the flows |
| **MC8 face**: bank display, the lit switch that recalls the scene, message counts per switch, page 2 when I–P are used; pressing a switch jumps to its scene | `controllers.mc8.banks`, compiled switch plans |
| **MIDI pulses** travelling the real MIDI cables from the MC8 (DIN → ML10X → Thru → BigSky; Omniport TRS → Sunset), labelled with channel and message count; a device no cable reaches is flagged on the board | `analysis.midi.routes` (new) and the compiled scene plan |
| **“✋ by foot”** tags on pedals that need a manual action | the compiled plan's manual steps |
| **What happens** (story in words: press, preset, L/R summaries, pedals, messages in order, manual steps, diagnostics) and **What changes** from the previous scene in the set (preset, paths, pedal states, programs, CCs, message count, new manual steps, bank change); changed devices pulse once | `lib/stage.ts` (`sceneStory`, `sceneDiff`) |

Loop state and pedal state are deliberately two different indicators: an ML10X loop being
engaged says nothing about an analog pedal's own bypass, and a scene that does not set a pedal's
state shows a dashed LED rather than a guess.

The Stage is **read-only** (verified by the browser scenario: the save state stays “Saved” and the
server revision stays 0 after a full tour), respects `prefers-reduced-motion`, and renders
the same facts on a phone-width layout (stacked).

### Supporting refinements

- **Cables leave jacks like real patch leads**: perpendicular to the jack's edge, then curve to
  the other jack (top-face jacks fall back to the Session 2 bend). Board and Stage share one
  layout helper (`frontend/src/lib/boardLayout.ts`), so a flow sits exactly on the cable the
  Board draws. The Board tab looks noticeably calmer as a result.
- **Rig library miniatures**: every rig card shows a true-scale miniature of its board
  (enclosures only, from the stored rig; `preview` on `RigSummary`, response-only, never part of
  a project file) plus a ▶ Stage shortcut.
- **Addressable workspaces**: `#board`, `#stage`, `#wiring`, … survive reload and can be
  bookmarked. (Two Session 1 scenarios derived the rig id from `page.url()`; they now strip the
  fragment.)

### Backend (small, tested)

- `PathStep` gains `out_port_id`, `in_port_id`, `cables` (physical facts per traced step;
  empty when nothing is cabled). `LoopOccupancy` / `Ml10xTopology` record the connection ids
  behind each conductor.
- `analysis.midi = {controller_id, routes}`: ordered MIDI cables from the MC8 to each reachable
  device (BFS through Thru).
- `GET /api/rigs` adds `preview` to each summary.

No schema or migration change; project files are unaffected (verified by the existing
round-trip tests).

## Creative decisions

- **Dark stage, lit board.** The editing canvas stays light and precise; the Stage is dark so
  the flows, LEDs and the lit switch read as *the rig under stage light*. Same enclosure tints
  in both, so devices stay recognisable.
- **Conductors, not “the signal”.** Left is green, right is rose, always, even on a mono rig;
  the stereo demo's return-only loop is the moment the model pays off: the rose path starts at
  the BigSky's OUT R, enters Return C Ring and leaves on Output Ring to Amp R, with no cable
  invented.
- **Virtual hops are visibly different from cables** (dashed, inside the ML10X), because the
  app's whole stance is that a preset is not a cable.
- **The diff is the setlist's story.** A musician cares about the transition more than the
  state; the panel answers “what do I need to do between these two sections?” including the
  foot/hand steps.
- **No fabricated hardware detail.** The MC8 face is a plan diagram (two rows of four, A–D below
  E–H as on the device display; evidence recorded as third-party/approximate in
  `docs/research.md`). Pedals are enclosures with an LED convention, not product art.

## Before / after

Before: to learn what “Heavy verse” does you read the scene form, the compiled message table,
the path sentence on the Wiring tab and the bank grid on the Controllers tab, and still could
not see which cable the right channel uses.

After: press ↓ on the Stage. The ML10X recalls preset 1; the green flow runs Guitar → Input →
Plumes → Sunset → BigSky → Output Tip → Amp L and the rose flow from BigSky OUT R → Return C Ring
→ Output Ring → Amp R; Plumes and Sunset light up, Sunset's program becomes 1, two MIDI pulses
ride the Omniport cable to Sunset and three ride DIN → Thru to the BigSky, switch B glows on the
MC8, Plumes carries “✋ by foot”, and the right-hand panel says exactly that, plus “Sunset:
bypassed → engaged; no program → program 1”.

Screenshots were taken of the home page, Board, Stage (both demos, all scenes, close-up and
phone-width) with Chromium and reviewed; two passes of visual fixes followed (cable exits,
internal arcs, label collisions, note truncation).

## Tests performed and results

| Check | Result |
|---|---|
| `backend: pytest -q` | **68 passed** (4 new in `tests/test_stage.py`: step jacks + cables on the stereo demo incl. return-only; empty / half-cabled loops carry only existing cables; MIDI routes through Thru and Omniport, and their collapse when the DIN cable is unplugged; no MC8 → empty routes; plus preview assertions in the cold-start test) |
| `ruff check` / `ruff format --check` | clean |
| `npm run lint` / `npm run typecheck` / `npm run build` | clean (one pre-existing unused-variable warning in `BoardTab.tsx`) |
| Playwright, production build, Chromium | **23 passed** (20 from Sessions 1–2 + 3 new: the stereo Stage tour with exact cable ids per conductor, LEDs, MIDI routes, lit switch, keyboard stepping, diff text, face press, read-only check; a broken loop shown as “breaks here” with the exact surviving cables; rig miniatures) |
| Manual screenshot review | no console errors on any page |

## Caveats and honest limits

- **Verified** functionality: everything in the tables above. **Exploration**: the exact look
  of the animations (dash flow, pulses) is a design choice, not a measurement; the MC8 face row
  order is third-party evidence (see research note).
- Jack positions still carry their evidence level; estimated positions are drawn where the
  Board draws them. The Stage adds no new position facts.
- Flows are drawn for the ML10X's conductors only. A rig without an ML10X still gets LEDs, the
  MC8 face, MIDI pulses and the story, but no audio flow (there is no preset to trace).
- Advanced presets with branches (one node feeding two) draw the primary chain; branches are
  listed by the backend but not yet drawn.
- The library computes previews by loading each rig on `GET /api/rigs`; fine for a personal
  library, worth caching if someone has hundreds of rigs.

## Part two: pictures of real pedals (same branch, same PR)

The owner asked for a user-managed image layer: photograph a pedal, draw a box around it, see it
at scale. Built as follows.

### What a user does

Open a profile (Device library) or select a device on the Board → **Add picture…** → choose a
JPEG/PNG/WebP → the crop editor opens on the stored, orientation-corrected copy with a selection
already locked to the device's width : depth → draw / move / resize with eight handles, nudge with
the arrow keys, turn the picture in quarter steps, choose *fit inside* or *fill & clip* → the
preview shows the picture in the real footprint with the jacks in place and a sentence explains
any margins or clipping in mm and % → **Save picture** → the Board, Stage and rig cards show the
pedal; **Recrop** reopens the saved selection, **Replace** uploads another photo keeping the crop,
**Remove** restores the enclosure drawing. A unit can also carry its own override picture.

### Design decisions

- **Server-side sanitizer, then crop in the browser.** The browser only ever sees the re-encoded,
  orientation-corrected copy, so the normalized crop is stable across devices and reloads and EXIF
  never has to be interpreted twice.
- **Footprint first.** The crop is fitted to the recorded mm; the picture never changes a size, a
  jack, a collision or a clearance. `calibrated` is about the workflow (made against known
  dimensions), not a claim about the dimensions' evidence, which keeps its own badge.
- **No stretching, ever.** A mismatched box is either letterboxed (enclosure colour shows) or
  clipped, and the editor says by how much. Perspective correction was left out deliberately: a
  top-down shot is the documented path, and a half-working warp would undermine trust.
- **Local-first, opt-in portability.** Plain project files are byte-identical to before; bundling
  pictures is an explicit export option that bumps the format version, and import re-validates
  the bytes like an upload.

### Verification

| Check | Result |
|---|---|
| `pytest -q` | **76 passed** (8 new in `tests/test_images.py`: sanitizer behaviour incl. EXIF orientation 6 and metadata stripping, SVG/GIF/text/truncated rejection, pixel limit and downscale, strict asset ids, profile round trip + analysis/preview resolution + delete refusal + removal, instance override and rotation, missing assets + bundled restore + tampered bundle, unchanged rigs; migration list updated) |
| Playwright | **25 passed** (2 new: the full upload → reject SVG → locked crop → resize/move/draw → fit report → save → Board at scale → rotation keeps jacks → persisted metadata + sanitized asset → reload → Stage → rig card → recrop → remove flow; and the no-dimensions / instance-override / export-format flow) |
| Screenshots | before/after on the stereo demo's BigSky: catalog, editor (initial, free-drawn, calibrated after a quarter turn), Board at 0° and 90°, inspector, Stage, home miniatures; no console errors |

Acceptance criteria 1–10 from the request are each exercised by the tests above; see
`frontend/e2e/images.spec.ts` and `backend/tests/test_images.py`.

### Caveats

- WebP uploads are stored as JPEG (or PNG when they have transparency); the stored copy is the
  sanitized one, never the original.
- The crop editor is sized for the inspector's column as well as the catalog page, but a very
  narrow window stacks the preview under the photo.
- Perspective and background removal are out of scope (documented in the editor).
- The asset directory is not part of the SQLite file: back it up alongside, or use the
  image-inclusive export.

### Review follow-up (image layer, 2026-10-16)

The owner's review asked for three narrow changes; all three are in and tested:

- **Fluid crop canvas.** The editor's photo frame now fills the available width (up to its
  natural size) and keeps the photo's aspect ratio; the overlay maps pointer positions through
  the SVG's own screen transform, so normalized coordinates stay exact at any size, and handles
  stay finger-sized via a resize observer. The editor's two columns depend on the editor's own
  width, not the viewport, so it works in the 340 px board inspector and on a 390 px phone. The
  Device library page itself now shrinks to phone width (its wide jack tables scroll inside their
  panel). Browser scenario: phone width, landscape photograph, no horizontal page scroll, locked
  resize and move with exact persisted coordinates.
- **No orphaned uploads.** Cancel discards every picture uploaded during that attempt (including
  replacements chosen inside the editor); saving keeps the chosen one and reclaims the ones not
  chosen plus the previously saved picture once nothing refers to it; Remove reclaims the removed
  picture. Reclaiming is best-effort through the normal delete, which the server refuses (409)
  for anything still referenced by another profile or unit. The Device library gains a
  **Pictures on this computer** panel (count, unused count and size, *Remove unused pictures*)
  backed by `GET /api/assets/images` (with a `referenced` flag) and
  `DELETE /api/assets/images/unreferenced`, which never touches a referenced asset (backend
  test). Browser scenario: upload → replace twice → cancel leaves the asset count unchanged;
  save → replace reclaims the old picture; an orphan shows up in the panel and is removed there
  while the used picture survives.
- **Lock stays honest on replacement.** When a replacement photograph has different pixel
  proportions, the saved crop is reconciled to the footprint's ratio (centre and width kept)
  while the lock remains checked; the editor is remounted per picture so this always runs.
  Browser scenario: portrait → landscape inside the editor, and landscape → portrait from the
  section, both end with the lock checked and the selection at 64 : 121 in the new picture's
  pixels.

Counts after the follow-up: **77** backend tests, **28** browser scenarios.

## Part three: image-assisted jack mapping (same branch, same PR)

The owner's Pedal Playground import populated dimensions for many pedals but no jacks, and the
table editor made configuring them tedious. Part three makes pointing at the photograph the
primary way to describe a device's connectors.

### What a user does

Profile with a picture → **Configure jacks on the photo** (Device library or Board inspector) →
the whole photograph with the enclosure crop and its top edge drawn → optional starter template
(mono / stereo / mono + MIDI / empty; proposals, stored as user entries) → click each connector:
a marker appears with a thin lead to where the cable will start in the board model, and a compact
editor opens (label, type, mono · L · R · TRS L+R, cable-exit edge, *more…* for id, direction,
connector, TRS MIDI wiring, pair group, clearance, notes) → drag to adjust, arrows nudge, Ctrl+Z
undoes → **Save jacks**. Existing jacks are drawn dashed at their wiring position until confirmed
on the photo; unknown-position jacks are listed "to place" and placed by clicking. Removing a jack
cables use shows the affected cables and requires *Remove anyway*.

### Architecture decisions

- **Annotation vs. wiring fact.** `image_anchor` lives on the port, in photo coordinates, next to
  the `edge`/`position` the wiring model reads. Recropping never moves a jack; replacing the photo
  flags markers for reconciliation (they keep working from their wiring position meanwhile).
- **Suggestion, never invention.** The nearest edge (≈12 mm on a calibrated device), the
  protruding side outside the crop, or top-face deep inside; position = projection of the click.
  The user can pin any edge. Everything entered carries *user* evidence, separate from the
  import's third-party dimensions and attribution, which are preserved byte for byte.
- **Ports-only update with cable protection.** `PUT …/ports` keeps every other profile fact and
  refuses to drop an id that any rig's cable uses until the user confirms; cables are flagged,
  never deleted.
- **TRS stays one socket.** Stereo TRS is one port (`stereo_trs`), L/R pairs are two ports with a
  pair group; the conductor-aware routing and the stereo demo are unchanged (test).
- **Editor placement.** The contextual card floats next to the marker when the photo is wide
  enough and otherwise lives at the top of the side column, so it never covers a connector; at
  zoom 1 the whole photo fits the visible area, zoom enlarges and scrolls.

### Verification

| Check | Result |
|---|---|
| `pytest -q` | **83 passed** (6 new in `tests/test_jack_mapping.py`: anchor ≠ geometry, anchor validation incl. asset presence, ports-only enrichment of an imported profile preserving its facts, rename/remove refused with affected cables then forced with `connection.port_missing`, stereo/TRS semantics and the stereo demo intact, builtins carry no separate evidence) |
| Playwright | **31 passed** (3 new: imported pedal → template → three clicks → move + relabel → save → placed on a Board with an amp → wired by dragging the new jack → reload keeps cable, positions and picture; existing jacks shown and dragged, unused removed, wired removal refused → keep → forced with the cable flagged; stereo template + TRS L+R, anchors outside the crop survive a recrop) |
| Screenshots | catalog with templates, markers after three clicks (DC anchored above the crop, lead to the top edge), expanded editor, the pedal wired on the Board |

### Known limitations

- No perspective correction or image recognition: the user points, Signal Loom suggests edges.
- Per-instance jack overrides are still edited with the existing outline/table editors; the
  mapper writes the profile.
- The "to place" flow places template jacks in list order; reordering is by removing and
  re-adding.

### Review follow-up (jack mapper, 2026-10-16)

The owner's review of the mapper found three narrow problems; all three are fixed with tests.

1. **Undo after a drag put the marker back where it already was.** The drag handler recorded
   the *post*-drag jacks as the undo step. The jacks as they were when the pointer went down are
   now captured in a ref and pushed on pointer-up. Writing the test exposed a second, quieter
   bug: after choosing a template (its buttons unmount) or closing the popover, keyboard focus
   fell to the document body, so Ctrl+Z, arrows and Delete did nothing until the user clicked a
   button. Pointer work on the photo now refocuses the dialog. The first browser scenario drags
   a marker, presses Ctrl+Z and asserts anchor, edge and position are exactly as before.
2. **"ports (not in dataset)" survived the mapping.** The importer declares that string, and
   `unknowns()` always echoed it. `DeviceProfile.reconcile_declared_unknowns()` drops only a
   declared unknown that is *about the jack list* once the profile has jacks; the separately
   declared power/MIDI unknowns stay until stated. Both the ports-only endpoint and the full
   profile save call it. Backend and browser tests assert the ports marker is gone and the power
   marker still shows after a mapping.
3. **Retyping a wired jack slipped past the guard.** The ports-only endpoint now compares, per
   retained id, what a cable relies on (`kind`, `direction`, `connector`, `audio_channel`,
   `trs_role`, `midi_trs_type`, `pair_group`, `role`) and refuses a change on a jack that a cable
   uses with the same 409 `ports_in_use` shape, each affected cable now carrying a `change`
   string (`"removed"` or e.g. `"kind audio → midi; connector ts_1_4 → din5"`). Filling in or
   un-stating a value (`unknown`/None on either side) is a refinement, not a contradiction, and
   passes; so do labels, positions, anchors, clearance and notes. The mapper's dialog explains
   the difference, offers *Keep those jacks as they were* (restores the original type while
   keeping the label/anchor edits) or *Change anyway*; after a forced retype the wiring check
   flags the cable with `connection.kind_mismatch`. Tests: audio→MIDI and out→in refused with
   the right `change`, cosmetic/refining edits accepted, forced change flagged; the browser
   scenario retypes the wired input from the dropdown, sees the dialog, keeps, and confirms the
   type is back.

Counts after the follow-up: 84 backend tests, 31 browser scenarios, lint/typecheck/build clean.

## Two next ideas

1. **Visual Advanced-mode editor on the Stage canvas**: drag from a Return jack to a Send jack
   inside the ML10X to add an edge, with the same per-direction cabling checks; the Stage already
   draws exactly what such an edge would do.
2. **Setlist export**: a printable one-page-per-scene “stage sheet” (board miniature with the
   flow, LEDs, switch, manual steps) from the same `sceneStory`, as a human-readable export next
   to the wiring manifest.
