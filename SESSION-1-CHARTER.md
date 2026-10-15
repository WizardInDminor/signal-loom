# Signal Loom — Session 1 Autonomous Build Charter

**Project:** Signal Loom  
**Repository:** https://github.com/WizardInDminor/signal-loom  
**Status:** Initial autonomous build experiment  
**Working product statement:** *Design the rig. Weave the signal.*

> **To the implementation agent:** This document is your primary product specification and execution charter. The repository begins as a blank slate. Research the relevant hardware and data formats, make sound architectural choices, implement a usable end-to-end product, test it, and document what actually works. You have broad implementation freedom inside the boundaries below. Do not stop after writing a plan or scaffolding a decorative prototype. Make concrete progress in code and commit your work. Where external hardware, undisclosed file formats, or credentials prevent verification, deliver the functioning portion, retain evidence, state the limitation plainly, and provide a reproducible next step. Do not invent compatibility.

## 1. The problem

Building and managing a sophisticated guitar rig currently requires hopping between pedalboard layout websites, cabling notes, device manuals, individual pedal editors, Morningstar editors, and the physical pedals. The user must maintain a mental model of physical fit, audio routing, MIDI control, song/scene presets, and hardware constraints. Changes in one domain often have consequences in several others.

Signal Loom should become a **unified, local-first workspace for designing, configuring, and maintaining a guitar effects rig**. It must treat a rig as a coherent system rather than an assortment of pedal photographs or unrelated MIDI messages.

The intended first user is a technically capable guitarist who **already owns a Morningstar MC8 (original model, not MC8 Pro) and Morningstar ML10X**. That makes eventual round-trip validation against real hardware possible. The user also works with a mixture of mono and stereo pedals, MIDI-enabled devices, and conventional non-MIDI effects. The software should be useful without any pedal connected to the computer.

The project is also an experiment in autonomous software delivery. A successful first session proves that a sufficiently clear product brief can produce a coherent, usable application rather than disconnected feature demonstrations.

## 2. The product promise

A musician should be able to:

1. Create a rig and choose a board with real dimensions.
2. Place dimensionally accurate pedals and controllers, rotate and rearrange them, and see physical fit and cable-clearance concerns.
3. Define actual audio, MIDI, expression/control, and power ports; map real physical connections between those ports.
4. Map physical audio connections into a Morningstar ML10X topology where that hardware is present.
5. Define reusable **scenes** describing the desired rig state: routing/loops, selected device patches, and supported controller actions.
6. Assign scenes and other actions to **MC8 banks and switches** and inspect the MIDI messages required.
7. Save, reopen, duplicate, import, and export the complete design without losing information.
8. Generate a readable wiring and configuration plan, and — where a real format is validated — an importable Morningstar configuration file.
9. Identify configuration problems *before* touching the hardware.

**North-star demo:** With no pedals plugged in, build a physically plausible board, wire its signal path, create three scenes for one song (clean intro / heavy verse / solo), map them to MC8 controls and ML10X presets, save the project, reload it, and inspect/export the compiled configuration.

The physical board, routing topology, and scenes must remain different views of **one persistent underlying model**, not independent mockups.

## 3. Architectural principles

These are the important design constraints; choose the exact implementation details yourself.

- **Hardware-independent core:** Separate a desired rig/scene state from the instructions required to implement it on specific hardware. Morningstar is the first adapter, not the fundamental data model.
- **Three distinct layers:** (a) physical layout and ports, (b) physical connectivity and logical audio/control topology, (c) scene intent and controller compilation. They should cross-reference common stable device and port IDs.
- **Definitions versus instances:** One device profile can be placed multiple times; placement, connections, and per-rig addressing belong to device instances, not a global definition.
- **Typed, directed graphs:** Audio, MIDI, expression/control, and power are distinct networks with different connection rules. A visually connected line does not mean a valid circuit.
- **Truthful capabilities:** Distinguish verified device specifications from approximations, editable user assumptions, and unknowns. Unknown connector positions and undocumented export formats must never be presented as fact.
- **Deterministic and explainable configuration:** A scene should compile to an ordered, inspectable list of actions or diagnostics, with enough source mapping to explain why each command exists.
- **Local-first, single-user V1:** No authentication, account service, or proprietary cloud dependency is needed for the first session. Saved rigs must survive a restart. A plain, versioned native project export should preserve portability.
- **Non-destructive hardware posture:** No automatic connection, sending live MIDI, restoring a hardware backup, or overwriting controller settings. Any eventual device upload must be an explicit action and should require a prior backup.
- **Prefer an integrated working vertical slice** over an attractive set of empty pages. Keep abstractions useful, but do not build a general-purpose electronics CAD or universal pedal editor.

## 4. Functional workspaces

### A. Rig library and device catalog

Allow creating, opening, renaming, duplicating, and deleting rigs with appropriate confirmation. A rig has an editable board footprint, device instances, cabling, optional controllers/switchers, scene definitions, and MIDI settings.

Provide a searchable device library and a custom-device editor. A device profile should be able to describe:

- Manufacturer, model, device category, source/provenance, revision, and optional image reference.
- Physical footprint: width, depth, height, display unit, and whether measurements include jack protrusions. Represent uncertain measurements honestly.
- Placement and rotation on the board; ideally provide grid/snap/zoom and a meaningful visual scale.
- Physical ports: label, direction, signal kind, connector type, channel/side where applicable, mounting edge, and approximate coordinate.
- Optional clearance needs for top/side jacks and cable plugs, distinguished from the chassis footprint.
- Electrical/power metadata, where known: voltage, polarity, AC/DC, minimum current, connector specification.
- Supported MIDI interfaces, receive channel, known Program Change/Control Change behavior, and documentation source.
- Capability records such as bypass method, patch selection, and whether parameters are addressable via MIDI.

**Pedal data research:** Investigate [Pedal Playground](https://github.com/PedalPlayground/pedalplayground), especially its public pedal catalog, as a potential source of names, dimensions, and pedal images. Other physical catalogs may be useful. Do not interpret public availability as redistribution permission. Determine and record licenses/permissions and attribution requirements before vendoring data or images. If permission is unclear, do not bundle third-party records or artwork: build a clean import path for legally supplied datasets and ship a small set of hand-authored, documented example profiles and visually clear generic silhouettes. No unauthorized scraping.

Pedal Playground's dimensions may include jacks/protrusions; the physical body footprint and connector clearance are not necessarily identical. Its data should not be treated as verified jack-location coordinates.

**Jack position editor:** A user must be able to add or adjust port locations relative to a pedal outline (normalized coordinates or equivalent), choose edge/connector/direction, and save the override. A top-down image overlay is a bonus. In the absence of verified coordinates, label locations as estimates or user-specified; never fabricate them as manufacturer specifications.

Prioritize a handful of plausible devices for the demo: Morningstar MC8, ML10X, Strymon Sunset and BigSky MX, a simple mono drive such as EarthQuaker Devices Plumes, and a generic mono/stereo effect. Meris Enzo/Hedra and Chase Bliss MOOD MKII are useful optional extensions. **Do not invent exact specifications for these named products**; use sourced values or explicitly marked placeholders. Make the project runnable even if none of the named profiles can be verified.

### B. Dimensionally aware board designer

Offer a usable interactive canvas with a board boundary and pedal footprints at a common scale. Support adding, moving, rotating, selecting, editing, and removing device instances. Show dimensions and placement coordinates; distinguish a deliberate overlap from an accidental collision. Highlight devices outside the board bounds. Render ports and optional plug/cable clearance where information exists.

Changes here must update the same underlying device instances used by the wiring planner. Do not make the visual arrangement only a static picture. Persist and round-trip board geometry.

The design can use generic shapes when licensed photos are unavailable. Correct geometry, predictable editing, and clear labels matter more than an enormous decorative image library.

### C. Wiring and signal topology

Offer a second diagram or focused editing mode for **physical** connections. Users select concrete source and destination ports. Support audio, MIDI, power, and expression/control connections as distinct visible types, with practical validation:

- Reject or flag incompatible signal domains, impossible directions, nonexistent ports, and duplicated exclusive inputs.
- Distinguish mono, stereo paired L/R connections, and TRS connectors when the available profile establishes their behavior. Do not assume every TRS jack represents stereo audio or every MIDI connector shares the same wiring standard.
- Preserve the distinction between a physical cable and a virtual path through an ML10X preset.
- Make connection ordering, labeling, and port identities easy to inspect.
- Allow the user to record cable length or connector style as optional planning metadata; do not fabricate automatically computed lengths.
- Detect obvious audio graph cycles and disconnected/unterminated routes, while permitting a user to mark an unusual connection as intentional.
- Include useful warnings for missing/unknown power requirements, voltage mismatches, polarity and current constraints, when those values are known. Unknown values should be warnings, not invented approvals.

Represent the ML10X as a concrete switching/routing device with real ports, a configurable loop mapping, and a topology model based on documented hardware capabilities. Verify stereo/mono grouping, split-loop behavior, and the current distinction between simple and advanced preset modes. A disconnected physical cable cannot be fixed through a scene change.

### D. Scenes, songs, and live-control planning

Make **scene intent** a first-class concept rather than asking a user to begin by typing MIDI byte values. A scene may express:

- The named song/section or purpose.
- Desired ML10X routing preset and/or loop states, as supported by the selected firmware mode.
- Device preset selections (PC with optional bank select), bypass states, or documented CC-controlled parameters.
- Controller bank/switch assignment, footswitch label, and action sequence.
- User notes and unresolved manual operations for analog/non-MIDI devices.

Allow multiple scenes and, if practical, an ordered song/setlist view. Show a side-by-side **desired state** and **compiled MIDI action plan**. Include channel, message type, numeric values, target device, ordering, and a diagnostic explanation.

Support basic MIDI Program Change and Control Change reliably before adding complex capabilities. Respect channel and value ranges, device-specific numbering conventions (zero-based versus one-based), and message/slot limits established by official specifications. Distinguish a deterministic state-setting command from a toggle whose result depends on the prior state. Prefer absolute state-setting commands when available; warn where scene recall cannot be guaranteed from an unknown starting state.

### E. Morningstar controller and switcher integration

**Hardware targets: the original MC8 and the ML10X**. Do not silently substitute MC8 Pro schemas, limits, or editor assumptions.

The MC8 planning interface should expose the constraints and terms that matter: banks, switch positions, labels, available actions, event types/toggles when supported, command stacking limits, and MIDI destinations. The user should be able to assign the three-scene demo across switches and inspect what each will send.

For the ML10X, support a meaningful model of loop assignments and preset routing. Do not conflate:
1. Which real-world cables are patched into sends/returns.
2. Which virtual audio paths are established by an ML10X preset.
3. Which MIDI commands select that preset or change supported loop states.

**Version-awareness matters.** Morningstar's ML10X Advanced Mode behavior has evolved, including changes associated with firmware v1.2. Older documentation may say an action is impossible when newer firmware supports it. Document the firmware/editor versions assumed and feature-gate uncertain capabilities instead of encoding obsolete blanket prohibitions.

**Export strategy, in order of increasing risk:**

1. Always provide an internally versioned **Signal Loom project** import/export round trip preserving all rig data.
2. Always provide a human-readable configuration package: wiring/port manifest, a scene/action report, and an MC8 switch map. CSV/JSON/Markdown are acceptable as appropriate.
3. Investigate official MC8 editor exports, bank/preset JSON files, sample backups, and the documented restore/import workflow. Implement a native export **only when its schema and semantics can be validated** with official examples, reproducible fixtures, or an official editor round trip.
4. Investigate official ML10X editor backup/preset formats. Apply the same rule: validate before producing a file advertised as hardware-importable. Handle checksums, metadata, firmware versions, and unsupported modes if present, and preserve any unknown fields during transforms when possible.
5. If direct native output is blocked by an undocumented or integrity-protected format, still deliver a complete explicit intermediate command/routing specification, a mapping into the official editors, and a precise blocker report. An invented JSON file with Morningstar-looking keys does **not** satisfy native export.
6. Never auto-upload to the user's MC8 or ML10X. An offline coding agent cannot claim successful hardware validation without hardware access. Produce a safe, reproducible verification procedure that includes backing up controller data first.

When a source requires real exported backup samples, document exactly what the user must supply, how to obtain them with the official editor, their expected sensitivity, and which validation will then become possible. Do not request passwords or device secrets. Imported backups should be treated as untrusted files and parsed defensively.

## 5. Useful research starting points

Verify details from authoritative/current sources, not these links alone:

- Morningstar MC8 controller documentation: https://manuals.morningstar.io/mc-midi-controller/MC8-User-Manual.929989199.html
- Morningstar MC MIDI editor documentation: https://manuals.morningstar.io/mc-midi-controller/Editor-User-Guide-%28Version-1.3.6%29.1035304961.html
- Morningstar ML10X user manual: https://manuals.morningstar.io/ml10x/user-manual
- Morningstar ML10X Advanced Mode update: https://help.morningstar.io/en/article/using-advanced-mode-in-the-editor-h936bv/
- Pedal Playground repository/catalog: https://github.com/PedalPlayground/pedalplayground

Create a compact research/compatibility document recording verified facts, sources, contradictions, assumptions, and the exact level of evidence for any export claims. Distinguish:
- **Documented:** Described in official/current vendor materials.
- **Fixture-validated:** Tested against an exported example with known results.
- **Editor-validated:** Imported into the official editor and inspected.
- **Hardware-validated:** Tested on the actual MC8 or ML10X.
- **Unverified:** Hypothesis or untested implementation.

Never report one evidence level as if it were a stronger one.

## 6. Implementation guidance and freedom

Preferred stack, consistent with the user's other engineering projects:

- Next.js / React / TypeScript frontend.
- FastAPI / Python backend.
- SQLite for local persistent storage, with explicit schema migrations or equivalent controlled initialization.
- A suitable canvas/graph library for the board and routing experiences (React Flow, Konva, or alternatives are yours to evaluate).
- Python or TypeScript validation/compilation as appropriate; make the domain rules straightforward to unit-test.

This is a preference rather than a mandate to spend the session on architectural ceremony. Use well-maintained dependencies, lock versions, document setup, and prioritize clear module boundaries. Keep the application accessible in an ordinary laptop browser; responsive layouts are desirable, but native mobile and elaborate touch editing are not Session 1 blockers.

Do not add accounts, user auth, telemetry, payment, generative AI, cloud sync, social sharing, direct USB/MIDI write capability, or a large scraped data warehouse merely to look ambitious. Avoid features and empty screens that cannot support the demo. No secrets belong in the repository.

Develop in coherent milestones. Investigate external compatibility early enough that the architecture can accommodate real constraints, but do not spend the entire session reverse-engineering native formats while the main application remains unusable.

## 7. Priorities when time or context is constrained

**P0 — A usable connected vertical slice (non-negotiable):**

- Runnable application with a sensible first-run experience and sample rig.
- Persistent rig/project lifecycle and import/export.
- Interactive dimensionally aware board with movable/rotatable instances and editable ports.
- Typed physical wiring editor/diagram with meaningful validation.
- Scene editor with at least three scene states and a real, inspectable MIDI PC/CC action compilation path.
- MC8 switch mapping and ML10X topology awareness, even if hardware-native output still requires fixture validation.
- Automated tests for the important model rules and serialization; clear setup and execution documentation.

**P1 — Verified interoperability:**

- Evidence-based MC8 editor-compatible export if achievable and verifiable.
- Evidence-based ML10X editor-compatible export if achievable and verifiable.
- Import/compare/round-trip tests, compatibility versions, and exact user hardware verification instructions.
- If either is blocked, document it honestly and keep the intermediate outputs actionable.

**P2 — Product polish:**

- Better device browsing, footprint snapping/clearance, richer warnings, richer scene organization, improved diagram interactions, a useful wiring bill of materials, and more MIDI capability profiles.

**P3 — Future ideas, not Session 1 requirements:**

- Live MIDI monitoring/USB control and automatic device discovery.
- Native vendor pedal-patch editing beyond documented MIDI commands.
- Setlist performance mode, multi-user sync, community libraries, cable-length auto-routing, elaborate power budgeting, and mobile-native apps.

Cut P2/P3 before compromising P0 reliability. If a complicated visual interaction proves too costly, deliver a simpler but working alternative rather than leaving the feature unimplemented.

## 8. Objective acceptance tests

The following are product-level tests, not requests for screenshots of mockups. Automate them wherever reasonably possible.

1. **Cold start:** A clean checkout follows the README and launches the frontend/backend and initialized database without manually editing source code.
2. **Rig persistence:** Create a named rig, place at least five device instances, save, restart the backend, reopen it, and observe unchanged properties and IDs. Export to a Signal Loom file, import it as a second rig, and compare normalized content.
3. **True scale and rotation:** A device with known example dimensions has proportional footprint on the board; rotation changes its bounding orientation and port coordinates coherently. Out-of-bounds and overlapping placements produce useful feedback.
4. **Port editing:** Add a custom jack with direction/type/position, connect a compatible port, persist it, and verify that selecting the device in another workspace refers to the same instance. An incompatible typed connection is rejected or explicitly flagged.
5. **Wiring integrity:** The demo rig shows a coherent physical signal chain with an ML10X integrated; removing one physical cable produces a broken-path diagnostic independent of the selected scene.
6. **Three-scene workflow:** Define clean intro, heavy verse, and solo scenes with distinct loop/routing and pedal-preset intentions. Save and reload them. Assign them to at least three MC8 switch actions or explain any selected controller constraint.
7. **Compiler:** Generate a deterministic, inspectable list of PC/CC actions including device targets, channel, type, data values, event/scene source, and diagnostics. Deliberately invalid channels, message values, or switch-message limits fail clearly rather than silently truncating. Recompiling unchanged inputs produces the same normalized output.
8. **Unknowns:** At least one example device has an explicitly unknown jack/power/MIDI attribute. The UI communicates the uncertainty; the planner does not fabricate compatibility or a precise measurement.
9. **Deliverables:** Export an intelligible wiring manifest and controller action map. Internal project JSON imports cleanly. Native vendor export is present only if its format has been validated at the claimed level; if not, the UI labels it unavailable/unverified and the research report explains why.
10. **Usability:** An actual user can accomplish the north-star demo through the interface, not by editing database tables or source fixtures. Basic keyboard access, visible selection, error states, and functional controls are expected.
11. **Quality:** Core unit/integration tests pass, a representative browser end-to-end path is exercised if feasible, and the codebase has reproducible lint/typecheck/build commands. Report any skipped, blocked, or failing tests explicitly.

Do not merely mark these tests complete in prose; implement test cases for logic and provide evidence for manual UI/editor verification where automation is inappropriate.

## 9. Expected repository deliverables

By the end of the autonomous session, the repository should contain:

- Executable app code and a small, useful sample catalog/rig with no hidden external dependencies.
- README with prerequisites, install, run, test, and a short tour of the three-scene demo.
- Architecture/domain-model note explaining persistence, graph semantics, scenes, and Morningstar adapter boundaries.
- Research notes with authoritative sources, pedal dataset licensing review, version-specific Morningstar findings, and actual native-export verification status.
- Automated tests and, ideally, CI for lint/typecheck/unit/build or equivalent gates.
- A concise **SESSION-1-RESULTS.md** describing what was built, what was proven, what remains unverified, how to validate using the user's MC8 and ML10X, and the highest-leverage next steps.

Make the initial user experience meaningful: empty-state guidance, a demo rig, functional creation/editing, and understandable error messages. Make reasonable product choices without requiring repeated stakeholder intervention.

## 10. Execution instructions

1. Inspect the repository and this charter. It is intentionally a greenfield project.
2. Perform a focused technical reconnaissance: official Morningstar capabilities/formats, physical device data/licensing, canvas/stack choice. Record pivotal findings and uncertainty.
3. Define a small, coherent domain model and build the P0 workflow end-to-end, with persistence and validation.
4. Test the product as a user, resolve practical UX and state synchronization problems, and then pursue P1 interoperability as evidence permits.
5. Run all available quality checks; commit substantive progress in logical units.
6. Write the session results with an explicit requirement-by-requirement status: **verified / implemented but unverified / blocked / deferred**.
7. If an external requirement is impossible to complete without a sample device backup or local hardware access, describe the minimum safe request and proceed with everything else. Never falsify an editor or device round trip.

**Definition of success:** Signal Loom is a working local rig-design application in which physical layout, connections, scene intent, and compiled controller actions are meaningfully integrated. The Morningstar export boundary is implemented where evidence supports it and clearly documented where it does not. Product coherence, truthfulness, and testability take priority over feature count.

---

*This is the Session 1 build charter. The implementing agent may make pragmatic technical decisions, but must preserve the product identity, the user-facing end-to-end workflow, and the distinction between validated native device exports and speculative formats.*
