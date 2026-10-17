# Signal Loom — Session 3: From Planner to Live Rig Control

**Repository:** https://github.com/WizardInDminor/signal-loom  
**Status:** Autonomous Session 3 build charter  
**Prerequisite:** Session 2 (including the PR #2 review follow-up) merged into the base branch.

> **To the implementation agent:** Read this document and the Session 1 and Session 2 records in full. Investigate the existing working application, implement the highest-value parts of this charter, test them, and report the results. You have substantial technical and product autonomy within the guardrails below. This is an execution charter, not merely a request for a plan. Do not merge the finished pull request automatically.

## Mission

Sessions 1 and 2 made Signal Loom a trustworthy **planner**: one rig document viewed as board, wiring, scenes and controller plan, with a deterministic compiler that turns scene intent into an explainable PC/CC message list. By design, nothing has ever been sent to hardware.

**Session 3 should make Signal Loom a single place to control the real pedalboard**: discover the connected devices, audition scenes on the actual rig, dial in sounds from per-pedal control panels, capture what was dialed in back into scenes, and see which MC8 scene is live.

The live layer must extend the existing model, not compete with it. Scenes stay hardware-independent intent; the compiler stays the single source of the messages; the live layer only **delivers** compiled messages and **observes** traffic. The planner must keep working, unchanged, with no hardware attached.

Favor one coherent, well-tested live workflow over many partially working device integrations.

## 0. Change in safety posture

Sessions 1 and 2 forbade any hardware communication. Session 3 relaxes that **only** as follows.

| Authorized in Session 3 | Still not authorized |
|---|---|
| Sending Program Change, Control Change and (P3) MIDI Clock to user-bound ports, **only while the user has explicitly armed live output** | Writing to MC8 or ML10X memory (presets, banks, settings) over MIDI, SysEx or any other channel |
| Receiving and displaying all incoming MIDI | Any SysEx message that writes, stores, or changes device settings |
| SysEx **read/identity requests** that are documented or evidenced as read-only (P3, behind an explicit per-device opt-in) | Firmware updates, factory resets, preset uploads to any pedal |
| Writing nothing but PC/CC/clock on the wire unless this table is amended | Sending anything automatically on startup, on page load, on port reconnect, or as a side effect of editing |

Additional rules:

- Live output starts **disarmed** on every backend start and after any port disconnect. Arming is a deliberate UI action and is visible at all times.
- Every message sent is logged with the compiler's explanation (or the panel control that produced it) and a timestamp.
- A visible **Stop** control cancels any queued messages immediately.
- Messages flagged non-deterministic by the compiler (toggle-style bypass etc.) require confirmation before they are sent.

## 1. Reconnaissance and continuity

1. Read `SESSION-1-*`, `SESSION-2-*`, `ARCHITECTURE.md`, `docs/research.md` and the README.
2. Confirm Session 2 is merged into the branch you develop from; if not, report the dependency and use the reviewed Session 2 implementation as the base.
3. Run the existing application and all test suites; record the baseline.
4. Re-read `domain/compiler.py`, `domain/wiring.py::midi_reachability` and `app/morningstar/` before designing the live layer. They are the foundation; reuse them.
5. Do not regress save ordering, stale-revision handling, export freshness or any Session 1/2 behaviour.

## 2. Target hardware (what the user actually owns)

The user currently owns the devices below. Facts marked *reported* come from retailer or forum sources and must be treated as unverified until the hardware validation step confirms them; record evidence levels the same way device profiles already do.

| Device | Host-facing interface | Notes |
|---|---|---|
| Morningstar **MC8** (original, **not** MC8 Pro) | USB device (computer ↔ MC8); DIN MIDI In/Out; Omniports usable as TRS MIDI out | **No USB host port.** *Reported:* "Cross MIDI Thru" in Controller Settings passes MIDI between USB and DIN, so the computer can reach DIN-chained devices through the MC8. *Reported:* multiple virtual USB MIDI ports. Verify both. |
| Morningstar **ML10X** | USB MIDI; DIN MIDI In / hard-wired Thru | *Reported:* must be powered by 9 V (not USB alone) to respond to MIDI; several ML10X on USB can collide on identical device IDs. Uses the existing compiler's PC/CC mapping. |
| Strymon **Volante** | USB MIDI; TRS MIDI via EXP/MIDI jack | Documented CC map in the manual. |
| Strymon **Zelzah** | USB MIDI; TRS MIDI via EXP/MIDI jack | Full PC/CC/clock over TRS or USB per Strymon product copy. |
| Strymon **Sunset** | USB MIDI (verify); TRS MIDI via EXP/MIDI jack | Already in the builtin catalog; extend its CC map. |
| Source Audio **Collider** | USB (mini) MIDI; DIN MIDI In/Thru | PC, CC and clock accepted over USB. The Neuro editor protocol is proprietary and out of scope. |
| Meris **Hedra** | **No USB MIDI.** Meris-specific TRS MIDI | Reachable only through a Meris-compatible TRS MIDI path (e.g. Meris MIDI I/O). |
| Meris **Enzo** (original) | **No USB MIDI.** Meris-specific TRS MIDI | Same as Hedra. |

Planned but **not owned yet**: Strymon TimeLine MX and BigSky MX. Keep their profiles (the demo rig uses the BigSky MX), but nothing in Session 3 may depend on them for validation. Design the vendor layer so they slot in later; the BigSky MX has published community tooling for SysEx and Strymon's own `strymon/spl` repository documents messages for earlier models — useful research, not a Session 3 dependency.

Add or complete builtin profiles for every owned device: footprint, jacks, power, MIDI interfaces, PC range and numbering, bypass command, and **the full documented CC map**, each with a source URL and evidence level. Do not invent CC numbers; a gap stays an explicit unknown.

## 3. Architecture: backend-owned MIDI

The user has chosen **backend-owned MIDI**: the FastAPI process is the only owner of MIDI ports. The browser never opens a MIDI port; it talks to the backend over HTTP and a WebSocket. Rationale: one owner for the USB devices, works in any browser, and the compiler and the sender live in the same process.

Suggested shape (adapt if investigation shows a better one; document the decision):

```
backend/app/live/
    transport.py   MidiTransport protocol: list_ports, open, close, send, receive callback
    rtmidi.py      real implementation (mido + python-rtmidi)
    virtual.py     in-process loopback + simulated devices for tests, demo and CI
    bindings.py    instance <-> port/route bindings (workstation state, see below)
    sender.py      armed state, ordered queue, inter-message delay, Stop, send log
    monitor.py     incoming traffic, decoding against profiles, scene follower
backend/app/vendors/
    capabilities, per-family helpers (strymon.py, source_audio.py, meris.py, ...)
backend/app/api/live.py   REST endpoints + /api/live/ws WebSocket
```

Requirements:

- **The rig document stays portable.** Port names are machine-specific. Store live bindings as workstation state (separate table keyed by rig id and port identity), not inside the rig document or the `.signal-loom.json` project file. Project files must import identically on a machine with no MIDI hardware.
- **Hot-plug.** Detect ports appearing and disappearing (polling is fine); a disappearing bound port disarms output and is shown in the UI.
- **Threading.** MIDI callbacks run off the event loop; hand them to asyncio safely. No blocking calls in request handlers.
- **Degrade gracefully.** If `python-rtmidi` cannot load (e.g. CI), the app starts with the virtual transport and says so.
- **Vendor boundary.** As with `app/morningstar/`, vendor-specific knowledge lives in `app/vendors/`; the core model never depends on it.

## 4. Routes and reachability

Every MIDI-capable instance gets a **route** from the computer:

- **Direct USB** — bound to a USB MIDI port (Strymon, Collider, ML10X).
- **Via MC8** — the computer sends into the MC8's USB port; the MC8 forwards to DIN or an Omniport; the existing cables carry it onward (e.g. MC8 → ML10X DIN → Thru → …, or MC8 Omniport → Meris TRS MIDI path).

Validate routes with the existing `midi_reachability` graph and cable model, extended with a "computer" node. A device whose route the cables cannot explain gets a diagnostic, not a guess. Where forwarding depends on an MC8 setting the app cannot read (Cross MIDI Thru), say so in the diagnostic and in the hardware validation steps.

Show for each device: bound / unbound, port present / missing, route, and last message sent/received.

### Design principle: wire once, reach everything

**The user must never re-plug a USB cable to change which pedal they are controlling.** The board is cabled once; from then on every reachable device is addressable at the same time from the one screen. This is a first-class requirement, not a convenience, and it shapes the binding model:

- **Many devices per port.** A binding is `(port, channel)`, not one port per device. Several instances may share one route (e.g. everything behind the MC8's single USB connection) and are told apart by MIDI channel. Validate that every device sharing a route has a **unique channel**; a collision is an error with the exact devices named.
- **All routes open at once.** The backend keeps every bound port open simultaneously, including several USB ports when a hub is used. Selecting a pedal in the UI never opens, closes or rebinds anything.
- **Route capabilities per hop.** Each hop declares which message types it passes (PC, CC, clock, SysEx), with evidence. Known constraints already in the catalog: MC8 Omniports cannot send SysEx; the ML10X DIN Thru is a hard-wired copy. Unknown (verify): whether MC8 Cross MIDI Thru forwards USB → Omniports and whether it forwards SysEx; what the Meris MIDI I/O passes. A device's controls are enabled only for message types its route can deliver; anything else is shown as "needs a different route", not silently dropped.
- **Coverage view.** A single table: every MIDI-capable device × (PC, CC, clock, SysEx) → reachable via which route, or why not. When something is unreachable, suggest the **smallest cabling change** (e.g. "move Volante to Omniport 3 and set it to MIDI out") rather than a USB swap.
- **Model the extra hardware.** Add profiles for the Meris MIDI I/O (the user owns one), a generic powered USB hub and a generic USB isolator, plus a `computer` device as the root of every route, so these topologies can be drawn and validated like any other cabling.

Two reference topologies to model in the demo data and evaluate in the results report:

1. **Single link via MC8 (default).** One USB cable: computer → MC8. MC8 DIN Out → ML10X In → ML10X Thru → Collider In → Collider Thru → Meris MIDI I/O → Hedra, Enzo. Strymon pedals on MC8 Omniports configured as TRS MIDI out. This reuses the cabling the board already needs for performance and covers PC/CC for every owned device, provided Cross MIDI Thru reaches the Omniports. Its limits (no SysEx on Omniports, Omniports shared with expression inputs, MC8 needed in the path) must be reported honestly.
2. **Single link via powered USB hub.** One USB cable: computer → (isolator) → hub on the board, with MC8, ML10X, Volante, Zelzah, Sunset and Collider permanently connected; Meris still via MC8 DIN → MIDI I/O. Every USB device gets its own port, so SysEx and vendor editors also work without re-plugging. Report the trade-offs: extra board cabling, hub power, and USB ground-loop noise (recommend an isolator on the uplink, and say this is a recommendation, not a verified finding).

The app should support both and mixtures of them (some devices direct on the hub, others behind the MC8), and pick, per device and message type, the bound route that can deliver it.

## 5. P0 — Discovery, monitor and scene audition

1. **Discovery:** list ports, suggest bindings by matching port names to profiles (e.g. a port containing "Zelzah"), let the user confirm or change them.
2. **MIDI monitor:** live view of incoming and outgoing messages, decoded against the bound device's profile (CC name, PC number, channel) where possible.
3. **Audition a scene:** an "Audition" action on a scene sends its compiled plan, in compiler order, over the bound routes, honoring the armed state, a configurable inter-message delay (default conservative, e.g. 20 ms), Stop, and the confirmation rule for non-deterministic messages. The send log shows each message with its compiler explanation.
4. **Dry run:** the same action with output disarmed produces the full send log without touching hardware. This is also how most tests exercise the path.

## 6. P1 — Live control panels and capture to scene

The core "dial in presets from one place" workflow.

- **Parameter model.** Extend `CcDef` (or add a parameter definition beside it) with what a control panel needs: display name, kind (continuous / toggle / enumerated), value range, enum labels, optional display scaling, grouping. Keep it backwards compatible with existing profiles and project files (bump the project format version only if unavoidable, with a migration).
- **Generated panels.** A Live tab renders one panel per bound device from its profile: knobs/sliders/toggles/selects, preset (PC) selector, bypass. No hand-built per-pedal UI.
- **Responsive sending.** Coalesce rapid knob movements (send the latest value at a bounded rate per CC) so dragging a control never floods a pedal.
- **Capture to scene.** "Capture" writes the panel's current program, bypass and CC values into a chosen scene's `DeviceSceneState` as an ordinary document edit (undoable, revision-bumped, saved through the existing queue). "Load scene" sets the panels from a scene and (when armed) sends it.
- **Honest state.** Most of these pedals do not report their state. Panels show values **as last sent by Signal Loom**, marked as such, never as values read from the device, unless a read path is actually evidenced (see §8).
- **Diff against scene.** Indicate where the panel differs from the selected scene.

## 7. P2 — MC8 scene follower and setlist view

- Listen on the MC8's USB port. When the user stomps a switch, match the outgoing traffic to the compiled scene plans and show the **active scene** prominently.
- Where the match is ambiguous or partial (e.g. a switch with extra messages, or messages that the MC8 does not echo to USB), say so rather than guess. Record which MC8 settings were required for the echo in the hardware validation package.
- A simple ordered **setlist/performance view** (scenes by song and section, active scene highlighted, next scene previewed) is welcome if it falls out naturally. It must be a view of existing scenes, not a new data model.

Writing MC8 banks remains the Session 1/2 backup-and-restore path. Do not program the MC8 live.

## 8. P3 — Research and extensions

Pursue only after P0–P2 work end to end.

- **MIDI clock.** Optional tempo per scene and a backend clock source for the clock-capable pedals. Measure and report jitter; if Python timing is not good enough, say so and leave it disabled by default.
- **Strymon read-only SysEx.** Investigate whether Volante, Zelzah and Sunset answer documented or evidenced read/identity requests (preset dump request, device identity). Implement only read paths, only behind a per-device opt-in, only with evidence. A read path that works would let panels show device-reported values and enable a preset backup/librarian later.
- **Device identity.** Use universal MIDI Identity Request where devices answer it, to improve binding suggestions.
- Record what would be needed for the TimeLine MX and BigSky MX once the user owns them.

Do not let reverse engineering consume the session.

## 9. Testing without hardware

The autonomous environment has no pedals. Build for that:

- The **virtual transport** and **simulated devices** (a fake pedal that tracks program/bypass/CC state from messages it receives; a fake MC8 that emits a scene's messages when "stomped") are first-class, not test hacks. The seeded demo rig should be operable in a "simulated rig" mode from the UI.
- Backend tests: binding, route validation, sender ordering, delay, Stop, disarm-on-disconnect, refusal of unauthorized message types, coalescing, capture-to-scene, scene follower matching, graceful fallback when rtmidi is unavailable.
- Playwright: arm → audition → send log; move a control → simulated device state changes; capture → scene updated and saved; simulated MC8 stomp → active scene shown.
- Prove that with live output disarmed **no** message reaches any transport.

### Hardware validation package (for the user)

Write `docs/live-hardware-validation.md`: short, ordered, reversible steps the user can run with their real gear, starting with the safest:

1. MIDI monitor only (nothing sent), each device connected one at a time.
2. One PC to one USB pedal (Zelzah, Volante, Sunset, Collider) and confirm the preset changes.
3. One CC per pedal against the documented map.
4. ML10X preset recall over USB (9 V powered).
5. MC8 Cross MIDI Thru: computer → MC8 → DIN → ML10X, then → Collider → Meris MIDI I/O → Hedra and Enzo. Then computer → MC8 → each Omniport (Strymon pedals). Record whether SysEx passes each hop.
6. Scene audition of the demo-style scene on the real board.
7. MC8 stomp → scene follower.

Each step states what to observe, what result confirms the profile, and how to record it so the next session can raise evidence levels.

## 10. Priorities

**P0 — Safe live foundation:** transport, bindings, routes, monitor, armed sender, dry run, scene audition, virtual devices and tests.

**P1 — Dial-in workflow:** parameter model, complete profiles for the owned pedals, generated panels, coalescing, capture/load scene.

**P2 — Performance awareness:** MC8 scene follower, setlist view.

**P3 — Research:** clock, read-only SysEx, identity, MX preparation.

## 11. Out of scope

User accounts, cloud hosting, remote access over the network, mobile apps, AI features, a universal proprietary preset editor, the Source Audio Neuro protocol, Meris preset librarian work, firmware updates, and any write to controller or pedal memory.

The backend binds to localhost only, as today. Do not expose MIDI control to the network.

## 12. Completion criteria

1. With no hardware attached, the app runs exactly as after Session 2, and all prior tests pass.
2. The user can see the MIDI ports on their machine, bind them to rig devices, and see each device's route and its validation.
3. A scene can be auditioned: dry run produces the exact compiled message list; armed output sends it in order, with delay, Stop, and a complete log.
4. Nothing can be sent while disarmed; ports reconnecting or the backend restarting never sends anything.
5. Owned pedals have profiles with documented CC maps and evidence levels; panels are generated from them.
6. A user can dial in a pedal from its panel and capture the result into a scene, which compiles and exports like any other scene.
7. Incoming MIDI is visible and decoded; an MC8 switch press (simulated in tests) shows the active scene, or an honest "unrecognised" result.
8. Project files remain portable: live bindings are never part of them.
9. Core live behaviours have automated coverage with the virtual transport.
10. `docs/live-hardware-validation.md` exists and every hardware claim carries an evidence level.
11. Every owned device can be controlled through one fixed set of connections: the coverage view shows each device reachable for PC/CC with no USB re-plugging, channel collisions on shared routes are reported, and message types a route cannot carry are disabled with the reason.

## 13. Expected deliverables

- Working live layer, Live tab, profiles, tests and passing quality gates (CI must not require MIDI hardware or system MIDI libraries; skip or fall back cleanly).
- Updated README and `ARCHITECTURE.md` (live layer, safety rules, bindings as workstation state).
- `docs/live-hardware-validation.md`.
- `SESSION-3-RESULTS.md` covering what changed and why, user-facing capabilities, architectural decisions, tests and actual results, regressions or defects, hardware evidence status per device, deferred work, and recommended next steps with the real board.

Use a dedicated branch, open a pull request against the appropriate base, and do not merge it automatically.

## 14. Open questions for the user

The agent should proceed on the stated defaults and record these for the user:

- **Meris MIDI path:** *Answered:* the user owns a Meris MIDI I/O. Model Hedra and Enzo as reachable via MC8 DIN (or the DIN Thru chain) → Meris MIDI I/O; the route itself stays unverified until the validation package confirms it.
- **USB hub:** does the user want a powered hub (topology 2) on the board, or only the single MC8 link (topology 1)? *Default:* implement and test both; recommend topology 1 for PC/CC control and topology 2 only when SysEx or vendor editors are needed.
- **Operating system** of the machine that will run the backend (affects port naming and ML10X multi-device behaviour). *Default:* support macOS, Windows and Linux; test on Linux with the virtual transport.
- **Sunset USB MIDI:** confirm on hardware. *Default:* profile lists USB MIDI as reported, unverified.
- **Which pedals sit on DIN/TRS chains vs direct USB** on the real board, and which Omniports are free for MIDI. *Default:* topology 1 (everything behind the MC8), with topology 2 modelled as the alternative.

## Autonomy and execution

Make engineering and interface decisions independently when the goals are clear. Extend established components rather than introducing competing systems. If a proposed feature proves impractical or misleading, document why and deliver the most useful achievable result.

Build incrementally, test continuously, commit coherent changes. Do not stop at planning.

**The defining question for Session 3 is:**

*Can a guitarist sit at one screen, see every pedal on their board, dial in a sound, save it as a scene, audition it on the real rig and know which scene is live, while trusting that Signal Loom never sends anything they did not ask for and never claims a hardware capability it has not verified?*

**Begin by inspecting the repository, establishing the current baseline, and executing the session.**
