# Signal Loom — Product Workflows and Acceptance Stories

**Status:** Living musician-facing product requirements, not a claim of shipped features  
**Authority:** [Project Charter](../PROJECT-CHARTER.md) for product principles; [Product Roadmap](PRODUCT-ROADMAP.md) for implementation status; [Architecture](../ARCHITECTURE.md) for technical reality.

## Reading these stories

These are end-to-end *jobs to be done*, not independent pages to create. Each workflow crosses multiple views of **one** rig. A passing test of one widget alone does not satisfy the full story.

- **Desired:** intended user experience.
- **Acceptance evidence:** what would convince us it works.
- **Status:** tracked in the roadmap and linked PRs, not duplicated here.

Hardware facts, CC maps, native editor formats, cable pinouts and measured clearances must be sourced or explicitly labeled unknown/user-entered. No story grants permission to send hardware writes without explicit arming.

## W1 — Build, revise and relocate a real pedalboard

**Situation:** A guitarist has a physical board with pedals of different shapes, top and side jacks, a controller and loop switcher mounted underneath, and a power supply that must fit.

**Desired flow**

1. Choose actual board dimensions and device profiles or make a custom profile with dimensions and measurement provenance.
2. Place, rotate and label device instances on the top, underside or off-board surfaces. Prefer a user-supplied pedal image where available; calibrate the picture, not the electrical specification.
3. Locate the actual jacks on the image/outline, annotate direction, signal kind and connector, and see resulting plug-clearance concerns.
4. Mount MC8, ML10X and Zuma where they actually belong; ensure cable access and usable clearance are represented or explicitly unknown.
5. Save, close, reopen and continue without drift.

**Acceptance evidence**

- Moving a pedal changes the same `DeviceInstance` that Wiring, Stage and exports reference; port overrides remain attached after rotation and reload.
- Measurements with unknown confidence, unverified mounting fit and clearance allowances are not rendered as certified fit.
- An intentional overlap is distinguished from an accident; top and underside devices are not treated as occupying the same surface.
- A project import/export does not silently discard custom geometry, manual attachments or images; the export explains whether it includes external assets.
- A real user's physical layout test catches a meaningful discrepancy and the model can be corrected without losing rig references.

## W2 — Plan, troubleshoot and document a complete physical signal path

**Situation:** The rig mixes mono and stereo audio, ML10X conductor-specific loop wiring, TRS/DIN MIDI and multiple power outlets. The musician needs to find an error before troubleshooting it on stage.

**Desired flow**

1. Draw actual physical connections between named source/destination jacks; show cable types and adapters only when wiring compatibility is known.
2. Model ML10X preset paths *inside* the switcher separately from physical cables. Follow Tip/Ring or L/R conductors end to end.
3. Associate devices with documented power ratings and individual power outputs; represent real cable assemblies when supported.
4. Inspect diagnostics, correction suggestions, cable inventory and overall wiring plan.
5. Fix a broken cable or route in one view and watch Stage/Scenes reflect the change.

**Acceptance evidence**

- Disconnected sends, open returns, incompatible port direction, invalid stereo split, MIDI channel collision on a shared bus, or known voltage/polarity/current mismatches are discoverable with a specific explanation.
- A virtual ML10X route does not repair a missing physical jack connection.
- Unknown device current draw or a TRS MIDI pinout is not silently assumed safe. Physical daisy-chain taps, when introduced, share power rather than becoming falsely independent isolated outlets.
- Cable descriptions remain tied to physical links rather than a second contradictory model.

## W3 — Build a song scene that can be explained and recovered

**Situation:** A musician has a clean intro, heavier verse and solo requiring different loop paths, preset recalls, bypass states and possibly manual changes.

**Desired flow**

1. Name a song and its ordered scenes, choose the ML10X preset and desired pedal state for each section.
2. Search the device's manual and choose a **named documented MIDI command** rather than memorizing CC numbers, or enter a command explicitly as user-specified with evidence level.
3. Show the resulting signal path on Stage, the MC8 switch/control intent and the exact ordered PC/CC messages, including target device, channel, values, numeric numbering convention and explanation.
4. Show any operation that cannot be completed by the controller: analog knobs, unknown firmware modes, toggle commands, unsupported hardware actions.
5. Export the intent and a human-readable reconstruction guide.

**Acceptance evidence**

- Scene compile output is deterministic and references the actual routed device instance and current channel.
- Applying a favorite command stores stable numeric intent and provenance: editing the reusable command definition later does **not** silently change an existing scene's bytes.
- Scene/rig serialization round-trips without changing compiled output; revisions and undo/redo do not lose edits.
- The Stage, Scenes, Wiring, Controller plan and exports all tell the same story.
- A Program Change is clearly identified as a **pointer to a pedal's hardware-stored preset**, not a backup of that preset's sound. Unstored physical parameter positions remain visible manual dependencies.

## W4 — Validate a planned controller action without trusting undocumented hardware behavior

**Situation:** The original MC8 and ML10X are the first target controllers. Vendor editor and firmware differences create possible mismatches between a printed manual, an exported file and the actual device.

**Desired flow**

1. Build a scene and inspect its MC8/ML10X message plan.
2. Show real physical routes (USB, DIN, MIDI Thru, Omniports) and per-message capabilities, required settings and evidence.
3. Validate routing against documentation and, later, on the owner's physical hardware.
4. Preserve usable operation of the MC8 when the computer is absent.

**Acceptance evidence**

- Original MC8 specifications are not replaced with MC8 Pro capabilities by assumption.
- Different USB endpoints may reuse one channel; pedals sharing one physical MIDI receiver bus are checked for unintended channel collisions.
- USB → MC8 Cross MIDI Thru PC/CC support does **not** imply SysEx passes; Omniports have documented SysEx restrictions; a physical ML10X Thru is not assumed to forward USB input.
- Strymon Sunset USB firmware access is not labeled a confirmed USB MIDI endpoint.
- Verified exported hardware formats are distinguished from hand-authored/estimated configuration instructions.

## W5 — Safely audition and refine a scene using real MIDI

**Situation:** A musician wants to adjust pedal parameters from the computer while the gig-ready board stays wired normally.

**Desired flow**

1. Choose the virtual simulator or real transport explicitly. Discover endpoints, bind routes and review which targets have documented, unverified, unsupported or unreachable PC/CC paths.
2. Dry-run a scene to see the exact bytes and destinations without generating *any* transport send.
3. Arm deliberately; acknowledge unknown physical routes/settings before sending; confirm state-dependent toggles separately.
4. Audition the scene or use a pedal control panel; show attempted/sent messages, observed incoming data and simulated state as distinct data.
5. Press Stop/disarm or disconnect without hidden resends; intentionally Capture to Scene only when satisfied.

**Acceptance evidence**

- Fully functioning virtual round trip with channel-filtered simulated pedals and no native MIDI library; the previous offline planning experience remains unaffected.
- Backend, not browser, owns MIDI ports; output is PC/CC-only until explicit later authorization. Network access is constrained locally.
- A cold start is disarmed; disconnect, lost endpoints, ambiguous bindings and enumeration failures fail closed; reconnect does not silently re-arm or replay a scene.
- Stop/disarm cannot acknowledge completion while additional unsent messages may begin; already-in-flight bytes are honestly accounted for.
- Per-binding workstation identities are **not** baked into a portable rig export.
- Capturing last-sent values never masquerades as reading the pedal's actual controls or backing up its stored preset.
- Real Windows hardware testing is logged per hop and per message. Simulator success is not hardware verification.

**Validation boundary:** On the Session 4 development branch the virtual path has automated coverage, while real MC8/ML10X and pedal tests remain user-run. See Session 4 validation checklist is currently [on the active development branch](https://github.com/WizardInDminor/signal-loom/blob/experiment/session-4-live-control/docs/live-hardware-validation.md).

## W6 — Reconstruct a sound months later

**Situation:** After a break, the musician opens a song and needs to remember how the working sound was built.

**Desired flow**

1. Select the song/scene and open a concise reconstruction dossier.
2. See actual cable topology, ML10X path, controller switch, pedal MIDI channels, exact commands and relevant manual/page citations.
3. See known external dependencies: hardware preset numbers that were not backed up, firmware settings, patch revisions, analog controls and intentionally shared channel behavior.
4. Compare the current rig to the original documented configuration where enough historical data exists; mark observations and corrections with provenance.

**Acceptance evidence**

- The dossier can explain what *is* recoverable from project state and what still exists only in a pedal's physical memory.
- Unknowns and changed command definitions are visible instead of being disguised as successful restoration.
- The product can provide genuinely useful instructions when no hardware is connected.
- Future device preset snapshots, if supported, are limited to formats and safety measures validated on real hardware.

**Current framing:** This is the central long-term quality test for the whole product, not a single standalone screen required immediately.

## W7 — Rehearse one performance against multiple real-world sounds *(proposed; not implemented)*

**Situation:** A musician is refining scenes and repeatedly puts down the guitar to adjust the computer. Each hand-played comparison is slightly different.

**Desired flow**

1. Record or select a dry guitar phrase in a separate Shared Looper/reference playback tool.
2. Route that audio at an electrically appropriate level/impedance through the *actual pedalboard* (possibly using a reamp path), monitor the wet return, and make the physical routing obvious.
3. Start/stop/repeat that phrase alongside Signal Loom's scene audition; compare Scene A and Scene B while hearing the same input.
4. Adjust scene PC/CC parameters; deliberately capture new intent and optionally save a named wet audio reference.
5. Later compare results with level matching, latency alignment and optional audio analysis—without promising bit-for-bit sound equivalence from a MIDI command match.

**Acceptance evidence**

- Playback is actually heard through the user's physical pedals, not through a cosmetic software-effects simulation.
- Audio engine owns loop storage/playback; Signal Loom owns rig topology, scene intent and MIDI. Their integration uses a small versioned contract, not a duplicated monolithic DAW.
- Clock/synchronization, stop/error behavior, audio gain/impedance and monitoring prevent feedback, clipping or misleading A/B tests.
- Audible audition, human-verified reconstruction and instrument-measured signal comparison are presented as different confidence levels.

**Status:** Future integration tracked by [Issue #5](https://github.com/WizardInDminor/signal-loom/issues/5). Not Session 4 scope.

## W8 — Move a rig between machines and protect user work

**Situation:** A guitarist changes laptop or shares a project backup without sharing machine-specific paths and MIDI ports.

**Desired flow**

1. Export a documented, versioned rig file and deliberately opt into including local managed images/PDF manuals when desired.
2. Import on another machine without losing stable device/scene/reference identities.
3. Rebind OS-local MIDI endpoints there, keeping physical wiring unchanged.
4. Make file omissions, older schema versions and conflicts clear.

**Acceptance evidence**

- Project export carries portable design state and exact scene numbers, not live Windows/macOS/Linux port identifiers.
- Local assets are included only when requested; no unsanctioned access to arbitrary paths, silent external downloads or leaked files.
- Migrations retain previous user data. No seed operation destroys a user's existing work.
- Multi-tab/stale-write conditions do not silently overwrite a more recent document revision.

## Acceptance hierarchy and development discipline

Product stories are ordered by **musician value and evidence**, not by how easily they can be shown in a screenshot. Do not treat proposed workflows as shipped capabilities.

A substantial future change should answer:

- Which existing job does it make faster, safer or more reliable?
- Which shared domain entities does it read or write?
- What physical limitation or undocumented capability could invalidate it?
- What automated checks prove its internal correctness, and which owner-led tests prove hardware behavior?
- Does the change preserve standalone, computer-free operation and the ability to reconstruct a rig later?

See [the Roadmap](PRODUCT-ROADMAP.md) for the current development gate and deferred work.