# Signal Loom — Product Roadmap and Decision Register

**Status snapshot:** 2026-10-17 (update after relevant PR merges or hardware test sessions)  
**Purpose:** Current product delivery gates, evidence, deferred opportunities and links. This file is **not** an implementation instruction and does not authorize new work by itself.  
**Enduring direction:** [Project Charter](../PROJECT-CHARTER.md)  
**Musician journeys:** [Product Workflows](PRODUCT-WORKFLOWS.md)  
**Technical model:** [Architecture](../ARCHITECTURE.md)

## How to read the status labels

| Label | Meaning |
| --- | --- |
| **Merged / available in main** | Implementation is on the default branch. Its limitations still apply. |
| **Built in draft PR / unmerged** | Code exists for review, but must not be described as shipped from \`main\`. |
| **Hardware-verified** | A documented test was actually performed on the specified physical device/firmware/wiring. |
| **Proposed / not implemented** | Product opportunity; no promise or permission to develop without an explicit session decision. |

Passing CI is automated evidence, **not** evidence that the owner's real pedalboard behaves as modeled. Manufacturer documentation is evidence of a published claim, not an observed result on a specific unit.

## Product capability map (at this snapshot)

| Area | Status | Evidence and current boundary |
| --- | --- | --- |
| Persistent, local-first rig/device/scene model | **Merged** | [Session 1 results](../SESSION-1-RESULTS.md), [architecture](../ARCHITECTURE.md): common IDs, save/revision discipline, typed connections, deterministic compilation |
| Practical jack-aware wiring, ML10X stereo/conductor paths and controller plan | **Merged** | [Session 2 results](../SESSION-2-RESULTS.md); vendor-specific export restrictions still apply |
| Stage / scene-first physical visualization | **Merged** | [Session 3 results](../SESSION-3-RESULTS.md) and merged [PR #3](https://github.com/WizardInDminor/signal-loom/pull/3) |
| User pedal photos, jack calibration, top/underside mounting and power planning | **Merged** | [Session 3 results](../SESSION-3-RESULTS.md); unmeasured mounting clearance, power cable assembly details and some specifications remain unknown |
| Local PDF manuals and named/favorite MIDI command library, exact scene snapshots | **Merged** | [Session 3 MIDI charter](../SESSION-3-MANUALS-MIDI-CHARTER.md); does not archive each pedal's stored audio preset |
| Virtual live PC/CC, route evidence, live panel controls, scene capture and provisional MC8 follower | **In draft PR** | [PR #4](https://github.com/WizardInDminor/signal-loom/pull/4), [Session 4 charter](https://github.com/WizardInDminor/signal-loom/blob/experiment/session-4-live-control/SESSION-4-CHARTER.md), [Session 4 results](https://github.com/WizardInDminor/signal-loom/blob/experiment/session-4-live-control/SESSION-4-RESULTS.md); passing automated tests on the branch **do not mean** this code is merged |
| Windows physical USB/DIN/TRS MIDI communication | **Not yet hardware-verified** | The owner must run the per-hop [live hardware validation checklist](https://github.com/WizardInDminor/signal-loom/blob/experiment/session-4-live-control/docs/live-hardware-validation.md) using the actual MC8/ML10X/pedals |
| Shared Looper / reference dry-signal replay and real-pedal A/B | **Proposed** | [Issue #5](https://github.com/WizardInDminor/signal-loom/issues/5), requires the live MIDI foundation plus a proven audio routing/playback strategy |
| Automatic audio-backed sound equivalence verification | **Research direction only** | Needs reference capture, level and timing alignment, known patch state and an explicit confidence model |

### Current gate: Session 4 real-rig validation

**Near-term objective:** Turn the substantial Session 4 virtual MIDI implementation into a reliable *observed* Windows + original MC8/ML10X workflow without compromising offline use.

Current action boundary:

1. Review and address all PR #4 safety issues, with explicit in-flight Stop semantics, idle hot-unplug handling, failed-enumeration fail-closed behavior and route acknowledgements.
2. Keep a **draft PR until first physical validation**. The product owner's manual test starts with safe monitor-only discovery, then a single documented, reversible PC/CC on one device at safe audio volume.
3. Test the MC8 Cross MIDI Thru and ML10X hard-wired Thru incrementally, and TRS/Omniports individually; record message kind, exact firmware/settings, signal path, confidence and observations.
4. Resolve divergences in the route model or real transport. Only then decide whether PR #4 is ready for merge.
5. Update this roadmap and the actual architecture/results when the implementation state changes. Do not call a hardware result verified unless a hardware test record supports it.

**Safety constraints:** MIDI arming is explicit; PC/CC-only output in the initial live layer; no writing hardware memories or arbitrary SysEx; no automatic send or rearm; MC8 stays operable without Signal Loom.

The product can be valuable even without Session 4 merging: the first five rows in the table are already on \`main\`.

## Next opportunities (prioritization candidates, not scheduled milestones)

| Opportunity | User value | Dependencies / scope guard |
| --- | --- | --- |
| **Rig reconstruction dossier** | Return months later and understand exact scene commands, external patch dependencies, manual settings and historical confidence | Build from existing scene/compiler/manual records; don't claim a PC number is a patch backup |
| **Physical power daisy-chain cable assemblies** | Accurately show splitter trunks/taps, plug types and bill of materials | Reuse the existing *electrical allocation* records; taps share a supply, never fake isolation. [Session 3 backlog](../SESSION-3-RESULTS.md#backlog-from-the-owners-physical-build-2026-10-16-not-in-this-pr) |
| **Underside clearance and mountability verification** | Confirm whether ML10X, Zuma and cabling can physically fit below the board | Measurements, mounting rails/brackets and cable clearance need evidence; no automatic “fits” without it |
| **Stage advanced-routing gestures** | Edit ML10X Advanced graph in the same visual context where its path is explained | Respect conductor/port constraints and share the existing scene model |
| **Printable stage sheets / setlist exports** | Human-readable backstop when a live rig needs reconstruction at a venue | Derive from Stage and scene model, not a parallel manual definition |
| **Reusable MIDI definition maintenance** | Deliberately reapply a changed command to selected/all scenes with preview | Preserve default snapshot stability; bulk changes must be explicit and reviewable |
| **Reference-loop audition integration** | Play one dry phrase through the actual effects while adjusting scenes | [Issue #5](https://github.com/WizardInDminor/signal-loom/issues/5). Shared Looper/playback API and safe guitar-level audio path first |
| **Wet-return capture and A/B comparisons** | Save audible evidence of sounds and quantify differences carefully | Capture chain, clipping/noise checks, level matching and time alignment; treat objective equivalence as experimental |
| **Validated hardware preset backup/restore** | Rebuild a physical patch instead of merely recalling a numbered slot | Only after vendor protocol/export research, user backups and non-destructive test plans; forbidden under initial live MIDI safety charter |

These candidates are deliberately unranked across user value, implementation difficulty and hardware uncertainty. Pick future session work from real usage and constraints rather than assuming a product-release schedule.

## Long-term integration: Shared Looper / audio reference

The [future feature proposal](https://github.com/WizardInDminor/signal-loom/issues/5) describes a valuable shift:

**A reference performance becomes the repeatable test input.** A dry guitar recording can be routed through the *actual physical board* while the musician switches scene MIDI and refines knobs from Signal Loom. Listening to identical input makes A/B comparison faster and more trustworthy than alternating between mouse and hand-played takes.

Proposed ownership boundaries:

- **Shared Looper or suitable audio playback engine:** loop storage, playback timing, start/stop/repeat, audio I/O status.
- **Signal Loom:** scene intent, physical graph, selected controller messages, live send safety, scene capture and configuration provenance.
- **Integration adapter:** typed and versioned playback commands, connection status, optional timestamps/synchronization; no unnecessary app merger.
- **Audio hardware path:** known guitar/instrument vs interface line levels, proper reamping where needed, safe gain staging, stereo/mono and wet-return monitoring. A software API link alone cannot route audio through real pedals.

Delivery order: manually heard loop-through audition → optional repeatable A/B and documentation → optional wet capture/analysis. Never call a subjective hearing test formal verification of the pedal's stored digital preset or every analog control value.

## Evidence and decision records

Use the existing sources rather than duplicating undocumented assertions:

- **Manufacturer manuals and research:** [docs/research.md](research.md) and user-attached manuals (with page citations where possible).
- **Architecture and model decisions:** [ARCHITECTURE.md](../ARCHITECTURE.md) for current merged implementation.
- **Development history:** Session 1–3 charters/results on \`main\`; [PR #4](https://github.com/WizardInDminor/signal-loom/pull/4) for unmerged Session 4 changes.
- **Hardware verification:** dated checklist/table recording device, firmware, transport, port, MIDI channel, command, expected effect, observed effect, restoration steps, and confidence. Avoid silently updating a route to “hardware verified” just because the button was clicked.

### Decisions carried forward

| Decision | Rationale | Reconsider only if |
| --- | --- | --- |
| Local-first rig and scene model | Offline gigs, privacy and portable knowledge | A real user workflow demonstrably needs optional connectivity |
| Morningstar MC8 original + ML10X as first reference | Matches available real hardware, permits physical validation | New hardware requires a separately researched adapter |
| Source-driven MIDI and evidence tags | Prevents fabricated CCs, SysEx and route assumptions | New manufacturer/manual/hardware evidence changes the claim |
| Keep Scene/compiler independent of MIDI sender | Preserves offline design and enables simulation or new transports | New protocol requires a compatible adapter, not a second scene source |
| Explicitly armed, fail-closed real output | Avoids unexpected preset/route changes during use | Product owner deliberately authorizes a new, tested operation |
| Wire once, reach everything | Minimizes cable swapping and setup friction | Individual routes are documented as physically impossible or unsupported |
| Shared Looper remains a distinct audio subsystem | Avoids turning rig management into an entire DAW | A later validated interface contract suggests otherwise |

## Maintenance guidance for future Claude Code sessions

At the start of a substantial new development session:

1. Read [PROJECT-CHARTER.md](../PROJECT-CHARTER.md), this roadmap, relevant workflows, the **current** architecture, and the session charter.
2. Check GitHub PR and branch state. A capability in a **draft branch** is not automatically present on \`main\`. Treat the snapshot above as historical when dates diverge.
3. State the targeted musician workflow, dependencies, validation gate and data ownership before implementation.
4. Follow established branch/review/CI rules; do not merge feature branches without explicit authorization.
5. Update the appropriate session results; update this status table only when evidence changes. Do not rewrite enduring product vision to describe incremental code.

*This document is intentionally changeable. The [project charter](../PROJECT-CHARTER.md) is the stable north star; this file is the time-sensitive map.*