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

## Two next ideas

1. **Visual Advanced-mode editor on the Stage canvas**: drag from a Return jack to a Send jack
   inside the ML10X to add an edge, with the same per-direction cabling checks; the Stage already
   draws exactly what such an edge would do.
2. **Setlist export**: a printable one-page-per-scene “stage sheet” (board miniature with the
   flow, LEDs, switch, manual steps) from the same `sceneStory`, as a human-readable export next
   to the wiring manifest.
