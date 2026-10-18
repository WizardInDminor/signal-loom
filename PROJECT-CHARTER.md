# Signal Loom — Project Charter

**Status:** Living product charter (not a session implementation assignment)  
**Product line:** *Design the rig. Weave the signal.*  
**Product owner:** The musician using and maintaining the rig  
**Scope:** Enduring product identity, principles and success criteria; implementation status belongs in the [Product Roadmap](docs/PRODUCT-ROADMAP.md).

> **North star:** Signal Loom is the musician's trustworthy, local-first source of truth for a guitar rig: how it fits, how it is wired, what its controllers are intended to do, what is actually known about the hardware, and how a sound can be reconstructed and refined. It should reduce the effort required to move between designing a sound, playing it, and returning to it months later.

## 1. Why this product exists

A capable guitar rig is one interacting system, but the information required to maintain it is scattered. Pedalboard layout sites know enclosures, spreadsheets know cable lists, manufacturer manuals know MIDI commands, device editors manage individual presets, and foot-controller software manages switch assignments. None of those tools necessarily describes the entire rig, its real wiring, and the intended result of choosing a song scene.

This makes rig changes unnecessarily fragile: a cable moves, a pedal's MIDI channel changes, a hardware preset is overwritten, or a scene no longer produces the sound it once did. Reconstructing why a configuration worked can mean digging through manuals and mentally correlating settings that live in different applications.

Signal Loom's job is to **preserve that context as one coherent system**, make changes explainable, and support repeated, evidence-based configuration of real hardware.

## 2. Intended user and scope

**Primary user:** A technically engaged performing and recording guitarist with an interconnected pedalboard, MIDI controller, audio loop switcher, power supplies, mono/stereo effects, and a mix of MIDI-capable and manually adjusted pedals. They may design sounds at a computer but must still be able to use the board at a gig without one.

**Initial real-world hardware reference:** Original **Morningstar MC8 (not MC8 Pro)** and **Morningstar ML10X**, along with a mix of Strymon, Meris, Source Audio, Chase Bliss and conventional pedals. This rig is a demanding design and validation reference, **not** a requirement that every future user own those devices or that every example profile represent owned hardware.

**Product stance:** Local-first, single-user, useful without physical hardware attached; capable of becoming hardware-connected where evidence, safety and platform support permit. Hardware adapters should be extensible without changing the underlying rig and scene concepts.

## 3. The enduring product promise

A musician should be able to:

1. **Design** a plausible, dimensionally accurate pedalboard, including distinct top, underside and off-board placements.
2. **Understand and edit** actual audio, MIDI, USB, expression/control and power connections between named physical jacks, with uncertainty and incompatibilities made visible.
3. **Explore** the effect of ML10X routing and scene choices on the real left/right signal paths, rather than only reading numeric tables.
4. **Document** each device's manuals, relevant MIDI commands, program-numbering rules, power requirements, known limitations and verification evidence.
5. **Define and recall** songs, sections and scenes as musician-facing intentions, then inspect the exact controller instructions and remaining manual operations required.
6. **Maintain** a reliable, portable record of the rig that survives restarts, revisions and exports without silently changing its meaning.
7. **Audition and refine** supported hardware settings from an explicitly armed live interface, without needless cable swaps or losing the standalone MC8 workflow.
8. **Eventually compare sounds** using a repeatable dry guitar passage played through the physical effects chain, with optional wet-audio references, without confusing a pleasant audition with proof of identical hardware state.

The first six are core product capabilities; the seventh is an incremental live-control capability subject to real hardware validation; the eighth is a **future direction**, not a shipped promise. See [Product Roadmap](docs/PRODUCT-ROADMAP.md).

## 4. Non-negotiable product principles

### One rig, one source of truth

The board, Wiring, Stage, Scenes, Controllers, device library and exports are **different views of shared underlying data**, not independent recreations. Device profile definitions are distinct from placed instances. Physical cable connections are distinct from ML10X virtual routing. Stable IDs and versioned persistence carry meaning between views.

An improvement to one workspace must not silently fork a second authority for MIDI commands, routes, power allocation or scene state.

### Hardware truth outranks visual polish

A plausible diagram is not evidence that a cable, signal level, power connection or MIDI message works. Record whether a fact is **documented by a manufacturer**, **entered or assumed by a user**, **simulation-tested**, **hardware-verified**, or **unknown**, in a way appropriate to that domain. Never promote simulation into a physical verification claim. Missing data is an explicit unknown, not a fabricated measurement or approval.

Photos and calibrated jack positions improve usability, but a visually compelling result must not misrepresent electrical compatibility.

### Intent, instructions, transmission and state are separate

- **Scene intent:** What the musician wants to happen, including routes, preset recalls, CC values and manual tasks.
- **Compiled plan:** Deterministic, ordered, explainable PC/CC (or other evidence-supported) instructions for a particular hardware configuration.
- **Transmission:** What Signal Loom attempted or sent; successful transport delivery does **not** prove a pedal obeyed.
- **Observed state / verification:** What a device actually reported or the musician tested. A foot-controller match can be *possible* or *ambiguous*, not certain by assumption.
- **Audio outcome:** What the chain sounded like under stated input, routing, level and monitoring conditions.

In particular, **saving a PC number does not back up the sound stored in a pedal's hardware preset**. A later overwritten patch may make the same PC recall a different tone. Any future preset backup or sound-verification feature must address this honestly.

### Durable, explainable commands

Prefer documented, deterministic absolute-state operations over toggles. Preserve the exact MIDI bytes a scene has adopted even if its reusable command definition later changes. Preserve named command provenance (manual/page where known) and warn when definitions become stale. Never invent manufacturer CC values, undocumented MIDI forwarding or native editor file formats.

### Wire once, reach everything — within real capability

A fixed upstream computer connection should expose as many physically reachable devices as possible, without changing USB cables for each pedal. Model both an original-MC8 USB-to-DIN/Omniport topology and a compatible USB-hub topology, plus mixes.

**Reachability is message-specific and evidence-specific.** PC/CC forwarding does not imply SysEx forwarding or vendor editor compatibility; direct USB does not imply an official editor supports the device. Channel clashes belong to shared receiver networks, not every device on the computer. The MC8 must remain useful with the computer disconnected.

### Safety is part of the user experience

Live communication is optional, explicitly armed and disarmed on startup and on relevant connection failures. A dry run sends nothing. Stop/disarm behavior must be predictable and honest about messages already in flight. Do not auto-write controller memories, pedal presets or destructive SysEx. Hardware-affecting features are built behind explicit authorization, documented capability and real user validation.

Power planning similarly requires truthful voltage, polarity, current and isolation checks; unknown loads and unverified daisy-chain configurations are never treated as safe by default.

### Local-first and user-controlled data

A musician can create, edit and inspect a rig offline. Rigs, user-supplied manuals and assets are managed deliberately; exports must say what they include and avoid silently leaking local files. Maintain backwards compatibility or explicit migrations for project formats. No cloud account, proprietary sync service or vendor editor is required for the essential planner experience.

### Build integrated vertical slices, not disconnected feature demonstrations

Features should help accomplish a musician task end-to-end and should earn their place in the coherent model. Test on real screens and real hardware where appropriate. Preserve working workflows and make limitations visible instead of building decorative controls that suggest unsupported capability.

## 5. Primary product experiences

| Experience | Essential outcome |
| --- | --- |
| **Rig design** | A dimensionally credible arrangement, physical mounting and connectivity, with diagnostics for uncertain fit/clearance |
| **Wiring and power** | A readable, editable inventory of actual jack-to-jack connections, path/loop diagnostics, and evidence-based electrical checks |
| **Stage** | A musician can select a song scene and *see* the physical path, device roles, switching intent and manual work |
| **Device knowledge** | Relevant manuals, citations, named/favorite MIDI commands and exact values are close to scene editing |
| **Scenes and controller plans** | Desired state becomes a stable, inspectable MC8/ML10X control plan without assuming unsupported native backup formats |
| **Live audition** | A deliberate arm → dry run → send → observe/capture workflow, with clear routing, warnings and cancellation behavior |
| **Reference playback** *(future)* | The same dry performance runs through the actual pedals while the musician adjusts and compares scenes |

The detailed end-to-end scenarios and acceptance tests live in [Product Workflows](docs/PRODUCT-WORKFLOWS.md). Do not mistake this capability map for a claim that every item is currently implemented.

## 6. Product boundaries

Signal Loom **is** a coherent guitar rig planner, configuration knowledge base, explainable MIDI scene compiler and, as validated, a live control companion.

Signal Loom **is not** intended to become:

- A general-purpose electronics CAD or circuit simulation product.
- A universal, unsupported clone of proprietary pedal/controller editors.
- A DAW or full audio production suite; reference audio should come from a suitable looper/playback subsystem.
- A hardware-presets backup application unless the exact export/import format and device write safety have been established.
- A cloud collaboration platform or an always-required gateway between MC8 footswitches and the pedals.
- An authority that asserts a sound is reproducible solely because PC/CC bytes match.
- A pretext for continually expanding implementation scope before validated user workflows work.

## 7. Success and evidence

Success is progressively demonstrated, not announced by a completed mockup:

1. **Offline reconstruction:** A saved rig reopens, preserves device/port identities, physical paths, scene meaning, manual citations and exact compiled commands.
2. **Planning integrity:** Contradictions are visible, changes propagate through the same data model, and unsupported or undocumented hardware behavior remains uncertain.
3. **Safe virtual audition:** A scene compiles, reaches simulated targets only when explicitly armed, and can be deliberately captured without modifying a scene unexpectedly.
4. **Real hardware reproducibility:** The musician validates documented PC/CC against actual devices and records which hops and states were observed, with reversible testing.
5. **Long-term confidence:** Returning months later, the musician can explain which physical connections, MIDI channels, commands, external hardware presets and manual settings a sound depends upon.
6. **Audio-guided refinement** *(future)*: The same dry phrase can be replayed through the actual rig for repeatable listening and optional wet-reference capture; hearing a result is not automatic proof of sonic equivalence.

A passing automated test and a user's real-hardware observation are different evidence classes. Track both.

## 8. Governance: how other project documents relate

This charter is **enduring** and should not be overwritten to reflect a single development sprint. Update it when the product's purpose, audience or governing principles actually change.

- [**Product Workflows**](docs/PRODUCT-WORKFLOWS.md) describes end-to-end user outcomes and acceptance expectations. Refine when user experience changes.
- [**Product Roadmap**](docs/PRODUCT-ROADMAP.md) records *what is merged*, *what is in progress*, and *what is proposed*, with links and validation gates. Update its status when PRs merge or issues change.
- [**Architecture**](ARCHITECTURE.md) describes *how* the code realizes the model. When code diverges, verify it and update the architecture; this charter should not pretend to describe the latest implementation.
- **Session charters** (SESSION-1, -2, -3, -4...) are time-bounded *implementation instructions*. They may change technical scope but must not silently supersede the permanent product commitments.
- **Session results, GitHub issues, PRs, hardware test records and research notes** are historical or evidentiary records. Preserve them even if later decisions change.

**Guidance to future autonomous coding agents:** Read this charter, the roadmap, relevant workflows, the current architecture and the active session charter before substantial implementation. Reconcile differences with current code and evidence; ask for a product-level decision rather than quietly redefining the product. Do not treat a roadmap idea as an authorization to implement or a future capability as a shipped feature.

## 9. Current long-term direction, not a locked release promise

Continue improving the accuracy and daily usability of the integrated rig workspace; establish reliable live MC8/ML10X/Pedal PC/CC control; improve the fidelity of saved configuration and hardware-validation evidence; then explore a **Shared Looper / reference-playback integration** that feeds a consistent dry guitar passage through the **real audio signal chain** during scene editing.

Potential later capabilities include wet-output capture, controlled A/B comparisons, verified preset backup formats, physical daisy-chain cable assemblies, underside-clearance verification, and human-readable stage sheets. They must be prioritized based on actual use and evidence, not assumed to be finished or authorized.

---

*Created October 2026 from Sessions 1–4, merged implementation history and subsequent product discussions. This document defines direction; [the roadmap](docs/PRODUCT-ROADMAP.md) carries time-sensitive status.*