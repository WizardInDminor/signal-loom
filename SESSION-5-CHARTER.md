# Signal Loom — Session 5 Autonomous Build Charter
## The First Playable Whole-Rig Instrument

**Status:** Authorized charter for the next autonomous implementation session.  
**Repository:** https://github.com/WizardInDminor/signal-loom  
**Baseline:** Main with PR #4 (Live Rig Control) merged at ef07632f0eaa3652b7478a9f2a853cd5dfb62e5b, plus this charter commit.  
**Implementation branch:** experiment/session-5-creative-instrument, created from the latest main.  
**PR policy:** Open a draft PR against main, leave it unmerged. Do not push implementation directly to main.  
**Companion:** [Creative Instrument Vision](docs/creative-instrument-vision.md) (the enduring product vision; not a claim of implemented features).  
**Inherited contract:** [Session 4 Charter](SESSION-4-CHARTER.md), [Architecture](ARCHITECTURE.md), and the physical hardware validation records.

> **To Claude Code:** This is an implementation charter, not an invitation to stop at planning. Read the specified context, inspect the code, establish a green baseline, build the bounded, integrated musical-instrument vertical slice below, prove the safety properties, run CI on the final commit, open a draft PR and report what works. Continue autonomously through normal corrections and reviews. The explicit success and blocked stop conditions are in §12. You do not have authority to merge your PR, overwrite user files, invent physical hardware evidence, or transmit MIDI to real hardware you cannot access.

---

## 1. Product mission and thesis

**Signal Loom is a creative environment that understands the rig — not a rig manager with creative features.** The musician should experience a mixed-brand physical pedalboard as a single, programmable, evolving musical instrument. Signal Loom itself does not generate guitar audio or reconstruct tones from neural predictions; the real guitar and pedals make the sound. Signal Loom supplies the musical language and reliable MIDI control connecting them.

Inspiration: the clarity and playability of sophisticated modular synthesis environments such as Arturia Pigments. Use that as a principle — macro controls, modulation sources, visible routing and evolution — not as an excuse to copy artwork or ship a synthesizer engine.

**Session 5's one demonstration:** A guitarist opens a named musical **Texture**, sees meaningful rig functions instead of a wall of manufacturer-specific controls, moves a single **Bloom** macro and drives **two distinct pedals** with opposite or independently scaled CC ranges; adds a slow tempo-related modulation, previews the intended values without MIDI sends, explicitly connects/arms/starts a virtual performance, observes safely paced changes, stops, saves, and later reloads the same musical idea.

Make that journey genuinely usable. One finished instrument is better than a decorative patchbay with 20 unimplemented modules.

### What Session 4 established

The owner physically verified MC8 USB/DIN/Omniport forwarding, seven-device scene auditions, ML10X cross-bank selection, documented Sunset bypass CCs, Last Sent → Scene capture, MC8 follower observation, Stop/Disarm, unplug/error fail-closed, backend restart disarmed, and external Morningstar Editor handoff. Source: docs/live-hardware-validation-2026-10-21.md and SESSION-4-RESULTS.md. Virtual regression suite is green on the Session 4 merged baseline.

Build **on** that backend-owned sender, route coverage, device and scene model, revision-safe autosaving and local-first application. Do not create a new competing MIDI writer or reset the architecture.

---

## 2. Read-first orientation and autonomous-agent lessons

Before coding, read in this order:

1. This charter and docs/creative-instrument-vision.md in full.
2. README.md, ARCHITECTURE.md, SESSION-4-CHARTER.md, SESSION-4-RESULTS.md, docs/live-hardware-validation-2026-10-21.md.
3. SESSION-3-DIRECTION.md, SESSION-3-FREESTYLE.md, SESSION-3-RESULTS.md, docs/future-features.md, SESSION-3-MANUALS-MIDI-CHARTER.md.
4. The actual implementation and tests: backend/app/models/{rig,profile,live}.py; backend/app/domain/{compiler,commands}.py; backend/app/live/{sender,service,routes,monitor,virtual,transport}.py; backend/app/api/live.py; frontend/src/components/{live,stage,scenes}; frontend/src/store/{rigStore,liveStore}.ts; frontend/e2e/live.spec.ts; migrations; CI workflow.

Inspect code before assuming a file, signature, or test exists. Validate the intended branch parent is the current reviewed main and that PR #4 merge is an ancestor. Record git status and baseline test results.

### Lessons from the previous autonomous experiments

- **One bold, bounded thesis.** The Session 3 freestyle Stage succeeded by choosing one unusually useful creative experience, implementing it completely and proving a browser journey. Session 5 needs a comparable experience, not a list of unfinished ideas.
- **Reviewed baseline and branch discipline.** Sessions 1–4 are merged, with documented charters/results. Start a fresh branch from main. Make coherent commits. Never silently expand scope or merge a draft PR.
- **Safety must survive adversarial review.** Session 4 review uncovered sender/disarm race conditions, hot-plug monitoring requirements, acknowledgment timing, duplicate Windows MIDI port ambiguity and enumeration failures. Those were fixed with regression tests. A repeating performance scheduler makes sender concurrency, cancellation and unattended output even more important.
- **Real tests, not passing assertions by declaration.** During Session 4, final CI uncovered Python formatting failures and an E2E selector that searched a static button label rather than the changing follower status. Fix the actual issue and rerun the full pipeline on the final commit, including browser tests.
- **Truthful evidence.** Published specs, user-defined mappings, simulated delivery, last-sent bytes, MIDI observed on a controller input and verified physical pedal behavior are distinct facts. Never turn a simulated test into a hardware-validation claim.
- **Persistent autonomous work is checkpointed.** Update SESSION-5-PROGRESS.md after each gate with the exact branch SHA, completed work, open issues, commands/results and next action. If a coding session compacts or restarts, reload this charter, the progress ledger and recent commits; resume rather than redesign.
- **Local-first and reversible changes.** Preserve SQLite rigs, stable ids, exports, autosave revision ordering, Stage, hardware planner, scenes, manuals and device profiles. Use additive, backward-compatible migrations and tests. No destructive reset, unsupported vendor magic, required cloud integration, or unlicensed art.
- **Don't stall for hardware that the agent does not possess.** Build a reliable virtual fixture and a clear owner-led physical test handoff. Missing private equipment is not an excuse to stop without implementing the virtual product.

Write a short SESSION-5-DIRECTION.md explaining chosen architecture and tradeoffs, then implement. Routine reasonable engineering decisions do not require user prompts. Research only when it materially improves truth, cite provenance, and avoid bringing secrets into the repository.

---

## 3. Durable conceptual hierarchy versus Session 5 scope

The full musical hierarchy is defined in docs/creative-instrument-vision.md:

- **Rig, device profile and physical connection:** what exists, how it is wired and which capabilities are known or unknown.
- **Scene:** a discrete desired state; preset recall, ML10X routing, bypass and known CCs. Scenes and their compiler remain canonical, and merely selecting/editing a Scene never sends MIDI.
- **Texture:** the new primary musical idea — descriptive name, intended sonic character, optional starting Scene reference, macros, modulation relationships, authored tempo and notes. References rig instance IDs; it is not another pedal configuration database.
- **Movement:** time-varying gestures, envelopes or rhythmic developments of a texture. This session implements only one safe repeating modulation path, not a full automation timeline.
- **Transition:** an intentional move between textures/movements, independently scaled across devices, acknowledging that MIDI presets may jump rather than crossfade.
- **Performance/composition:** arrangements, expressive cues, modular song structures, spontaneous performance history.

Only **Texture and one bounded movement** are required now. Define extension seams for the remaining concepts; do not add placeholders solely to claim they exist.

### Required vertical slice — all of these belong in Session 5

1. A new musician-facing **Instrument** workspace / Texture selector. Functions such as drive, pitch, modulation, delay, space and routing organize the actual device instances; labels/roles must remain editable and evidence-aware, not tied to one brand or imaginary signal flow.
2. First-class, persistent, user-editable **Textures**, including create, rename, duplicate, notes, optional base Scene, a macro, mapping relationships, tempo/LFO settings, save, reload and export/import roundtrip.
3. At least one **macro affecting two distinct MIDI-capable device instances** through two explicitly selected, eligible deterministic CCs, each with independently authored min/max and direction (inverse movement is intentional).
4. A **pure math evaluator** for macro and CC mapping; real preview produces zero MIDI sends.
5. One **tempo-related LFO** (triangle recommended) with BPM, division, depth and visible phase/effective value.
6. A backend-owned **bounded performance engine** with explicit Start/Stop, safe transport ownership, lease/heartbeat preventing indefinite operation after browser loss, and no implicit Start on rig/Texture selection or reload.
7. An isolated **virtual example** with synthetic, clearly labeled continuous CC capabilities so the full flow works without hardware. Do not claim a real Sunset bypass CC is a smooth continuously variable knob.
8. UI clarity, automated tests, documentation, progress ledger, results report, and a draft PR with final-head CI green.

### Not included in the Session 5 implementation

Do not implement full Experiment Lab/random PC shuffling, a DAW automation timeline, multiple modulation-summing engines, full movements/transitions/compositions, external MIDI Clock sending, synth/audio DSP, guitar tone inference, SysEx, preset memory writes, arbitrary factory patch discovery, live MIDI learn/expression controller support, Shared Looper integration, uploaded MP3 audition, remote MIDI access, user accounts/cloud dependencies, or broad unrelated redesigns. **Preserve these ideas in the creative vision/backlog.**

Experiment Lab remains an **explicit isolated opt-in future feature**. Randomizing pedal combinations must never leak into Scene management, verified operations or normal performance.

---

## 4. Data model, provenance and compatibility

Favor an additive Pydantic model with matching TypeScript types and rig-document persistence, using existing IDs, Rig revision semantics and server validation. If a different implementation is safer after inspection, document why and preserve the same guarantees.

Suggested conceptual fields (actual identifiers are the implementer's choice):

- **Texture:** stable ID, human name, brief musical intent and notes, optional base_scene_id, tempo_bpm within validated bounds, macro list, one modulation source reference and authorship/provenance.
- **Macro:** stable ID, name, normalized base/default [0,1], one or more destination mappings.
- **Destination mapping:** stable mapping ID, rig instance ID, parameter/CC identity linked to an existing MIDI command or documented CC, authored safe output_min and output_max within 0–127, label, eligibility provenance, enabled state. An inverted mapping may have output_min greater than output_max. Display the device's channel, route status and uncertainties.
- **Modulation:** one named triangle LFO per macro at most in this phase, time division in beats, depth in [0,1], enabled state. Do not invent generic multi-source priority/summing semantics yet.
- **Runtime:** current phase, lease, send counters, last-commanded CC and transport state are **not** portable rig settings or authoritative pedal state.

The app must load old rigs with zero textures; no existing Scene, device instance, profile, command or cable may be erased or rewritten by migration. Duplicating and importing a rig must preserve/repair ID references appropriately. A missing base Scene or removed instance produces a repairable warning rather than crashing or silently retargeting another pedal. Export/import and autosave (single-writer revision queue) must round-trip authored Textures. Store transient performance parameters apart from saved musical intent.

A Texture is its own musical object, not a Scene automatically modified by performance. Save Texture explicitly/deliberately and reuse existing revision-save behavior; don't silently overwrite an existing Scene.

---

## 5. Deterministic evaluator and musical scaling

Implement a pure evaluation layer independent of React, real-time clocks and MIDI send calls. Define and test its exact numeric semantics:

- Macro base b in [0,1]; triangle LFO l(t) in [-1,1]; depth d in [0,1].
- Musical LFO period = (beats_per_cycle × 60 / BPM) seconds. BPM and beat division must be validated; time reference for live evaluation is backend monotonic time.
- Effective macro e(t) = clamp(b + d × l(t), 0, 1). Disabled LFO uses e=b. Specify triangle phase=0 and expected quarter/half/full-cycle outputs consistently.
- Each target output = clamp(round_deterministically(min + (max−min) × e), 0, 127). Define half-step rounding in one tested function (e.g. half-up, not language-dependent banker's rounding). Reversed min/max yields an inverse gesture.
- Reject NaN/infinity, invalid BPM/depth, invalid CC and invalid addresses. No implicit remapping to a different device when a target disappears.
- Deduplicate unchanged seven-bit values; never send more frequently merely because the UI redraws. Modifying tempo should have documented phase behavior and must not trigger a burst of delayed MIDI events.

**Do not assume every MIDI CC is continuously movable.** For normal hardware, continuous modulation eligibility requires an explicit repeatable/deterministic supported control, documented or deliberately user-declared safe for this device/target/range. Unknown value semantics must not be silently promoted to a 0–127 analog sweep. An explicit user-defined override requires a warning and provenance; never treat an unnamed raw CC as safe by default.

Do not modulate CC 0 or 32 (bank selects), CC 120–127 (channel-mode sensitive), PC preset recalls, bypass toggles, destructive/global commands or memory-writing operations. Unverified or unsupported routing is not silently safe. Preserve all existing per-route prerequisite and user acknowledgment guards; only send when the actual endpoint is open and suitable at dispatch time.

The **Undertow** example may use synthetic CC 21 on one virtual device mapped 100→30 and synthetic CC 22 on another mapped 15→110, with a Bloom macro and slow LFO. These are **test fixture values only**, not claims about any actual Strymon/Meris/Chase Bliss device.

Tempo is a reference for internal modulation. It does **not** automatically transmit MIDI Clock to the board.

---

## 6. Live streaming architecture and safety invariants

A continuously ticking modulation engine is qualitatively different from a finite Scene audition. Integrate **narrowly** with backend/app/live; do not introduce browser Web MIDI output, a second ungoverned sender or a new process with conflicting port ownership.

### State model

Implement states equivalent to IDLE/PREVIEW, ARMED_NOT_PERFORMING, PERFORMING, STOPPED/FAULT. The inherited backend Live service owns the ports. The physical or virtual transport must be explicitly selected and connected. Session 4 arming remains separately required, then the musician takes a **separate explicit Start performance** action for one Texture.

Loading a rig, opening the workspace, selecting a Texture, adjusting a macro, changing BPM, previewing a mapping, saving or reloading **must not start transmitting**. An armed backend alone is not permission to run a continuous modulation stream.

The performance engine must:
- use backend monotonic timing and a testable clock abstraction; UI timers render/poll but never own send scheduling;
- default to a documented conservative aggregate budget, **no more than 20 CC messages/second** and **no more than 10/second per individual destination**; bound pending work and show planned versus sent/dropped/deduplicated counts;
- use per-device+CC deduplication and last-value coalescing; a delayed worker must not replay obsolete waveform history or allow one target to starve another;
- reject unsafe/unknown targets, disconnected/unavailable endpoints and unacknowledged route prerequisites **before** any queue insertion;
- reject competing manual sends/Scene auditions affecting performance targets while performing, or stop the performance and require explicit re-authorization; choose and document one deterministic rule. No hidden racing streams.
- upon Stop, Disarm, disconnect, port release, loss/ambiguous identity, driver error, backend close, mode switch, rig switch or bindings change, halt future modulation and clear pending values. Stop returns only after any in-flight driver handoff completes; no further sends after the stop acknowledgment. Prior sent messages are not undone or presented as restored state.
- always start a new backend process DISARMED and NOT_PERFORMING.

### Unattended-output protection

The controlling browser must hold a **short renewable lease** (e.g. heartbeat every ~1–2 seconds, backend expiry within ~5 seconds). Lease expiry stops modulation even if the backend remains running and armed; heartbeat is separate from passive UI polling. Closing the tab, losing network, browser crash and another tab must not produce an indefinite unattended stream. Only one controller can operate a performance session; second tabs must not silently hijack or rearm. Preserve the loopback-only API restriction from Session 4.

### Fail-closed tests

Use fake transport and deterministic clock/barriers, not timing-sensitive sleeps, to prove Stop priority, blocked-in-flight interactions, lease expiry, disarm/release/unplug, reconnect not rearming, queue boundedness, driver exceptions, and no send after stopping returns. Existing Scene auditions and panel sends must remain correct. Logs must distinguish authored intent, preview, queued, SENT, FAILED, CANCELLED and virtual device state. Never imply a real pedal acknowledged a successful PC/CC because python-rtmidi reported send completion.

---

## 7. Musician-first interface — whole rig, not brand silos

Build an Instrument workspace with a distinctive but usable visual hierarchy:

**What am I playing?** Texture name, musical description, optional starting Scene, BPM and a large expressive macro. Clear Save/duplicate and named user ideas.

**What does it move?** A functional rig grouping (drive, pitch, modulation, delay, reverb/space, routing), with actual device names and an obvious Macro → mapped CC destinations relationship. Show range/direction/semantics, MIDI channel, eligibility, route status, and which values are synthetic simulation.

**What is happening?** Macro and LFO inputs, effective macro, mapped seven-bit values per destination, clearly labeled PREVIEW/DISARMED/ARMED/PERFORMING, virtual versus real transport, send counters and prominent Stop. Animate modulation without requiring motion to understand it; honor reduced motion.

Interaction goals: fast idea creation, understandable instrument-style controls, minimal modal friction, keyboard-accessible labeled controls, a useful narrow viewport, and good disabled states with actionable reasons. Existing Board, Stage, Scenes, Live and Exports tabs must continue to work.

When the current real rig has no verified eligible continuous CC destination, show a truthful **not yet controllable** state and offer the isolated synthetic virtual demo. Do not fabricate pedal control maps to populate a pretty screen. Connecting from a phone or remote computer to inspect/edit must not bypass localhost MIDI send restrictions.

---

## 8. Phased delivery plan (progress must be checkpointed)

**P0 — Orientation, baseline and technical design.**
Confirm latest main ancestry including PR #4, branch from main, inspect app as a musician, run baseline backend Ruff/pytest, frontend lint/typecheck/build, full Playwright. Record counts and limitations. Write concise SESSION-5-DIRECTION.md describing schema, evaluator, safety state machine, send ownership, lease, scheduler budgets, UI and the deliberate virtual fixture. Initialize SESSION-5-PROGRESS.md.

**P1 — Persistent Texture and expressive static UI.**
Implement additive Pydantic/TS Texture types, rig save/export/import/migration/backward compatibility, validation for dangling references, and UI for create/rename/select/edit/duplicate/save/reload. A Texture has at least one Macro and two mapped destinations across distinct device instances; function grouping, explanatory mapping and honest empty/unknown states. Before real send code, preview must be non-transmitting.

**P2 — Deterministic math, two-device macro and one LFO.**
Build pure evaluator, reversed scaling, rounding, source phase, tempo/division/depth and bounded values with tests. Use a synthetic virtual fixture to demonstrate a single macro moving one device value up while another goes down, with a tempo-related movement and responsive visualization. Persist authored settings; don't auto-save every transient phase tick.

**P3 — Guarded backend live performance.**
Add minimal backend API/service with guarded Start/Stop/status/lease and safe scheduler integrating the Session 4 sender. Implement rate limits, coalescing, deduplication, stale session expiry, Stop/Disarm priority and fail-closed hardware route checks. Unit/integration tests first. No actual physical sends by the agent unless the hardware is explicitly attached and the owner separately authorizes a test.

**P4 — Finish the entire musician journey and review.**
Run the browser from actual code. Add one Playwright flow for: create/open Undertow; adjust the Bloom macro; confirm two mappings/independent ranges and zero transmissions from preview; set tempo/mod depth; connect virtual; explicitly arm; Start; observe safely bounded virtual CC changes; Stop; verify no further messages; save/reload Texture; confirm authored intent, Stage and existing Scene unaffected. Add safety-negative tests, check narrow viewport/keyboard/reduced motion, and update README + ARCHITECTURE. Document actual test results and limitations. Review sender and data persistence adversarially and resolve found issues. Open a draft PR, ensure CI succeeds **on the final PR SHA**.

After each phase append a **durable checkpoint** to SESSION-5-PROGRESS.md: gate, commit SHA, decisions, commands/results, blockers, next action. Do not stop or reset when context is compacted: re-read charter, Progress, newest diffs and resume.

---

## 9. Acceptance evidence matrix

The agent must prove, not merely say, all of the following.

### Domain and numerical model
- Legacy project import works, existing rigs start with zero Textures and no Scene loss; full Texture roundtrip save/reload/duplicate/export/import works.
- Editing or deleting a mapped device/Scene yields an honest invalid/reference warning and cannot silently retarget a different pedal.
- Independent mapping test cases at macro 0, 0.5 and 1 include forward and reverse ranges with exact rounding. Half-cycle/quarter-cycle triangle values, BPM/division, depth=0 and invalid inputs are tested.
- CC eligibility rejects toggles/discrete bypass, unsupported controls, bank-select CC 0/32, channel-mode CC 120–127, invalid channels, unknown device or unsafe ranges.

### Runtime safety
- Opening, selecting, editing, saving, previewing, refreshing and navigating cause **zero MIDI send calls** even if armed.
- Actual performance Start is separately intentional and refused for disarmed/disconnected/unknown/unacknowledged targets.
- Per-target and aggregate budgets hold in deterministic fake-clock tests, no unbounded queued messages accumulate, newest value wins and unchanged CC values are deduplicated.
- Stopping during in-flight sends, disarm, endpoint release/unplug, missing port, transport driver error, mode changes, backend shutdown and browser lease expiration cancel future sends. No output starts after Stop/Disarm returns.
- Backend restart never resumes performance or arms automatically; a second browser cannot silently assume control; finite Scene audition and panel send semantics remain unaffected.
- Real MIDI control remains localhost-only; virtual success is not a claim of physical pedal verification.

### End-to-end product experience
- A demonstrable functional **whole-rig Texture** includes one Macro, two distinct device CCs with independent/inverted ranges, one tempo-related modulator, visual routing and honest status.
- An actual Playwright scenario completes the full virtual journey, including preview→Start→Stop→save→reload. Repeat running the entire existing E2E suite, not just new tests.
- Desktop and narrow viewport checked. Screenshot(s) captured and inspected if the test environment supports it; otherwise record inability without inventing screenshots.
- Existing Board/Wiring/Stage/Morningstar planning/Scene compilation/Live backend/API/Last Sent capture/editor handoff protections remain intact.

### External hardware boundary
The owner must later approve and perform physical checks only after identifying at least two **documented, suitable continuously variable CC targets**. The physically verified Sunset CC10 and CC15 are **bypass controls**, not evidence of safe analog sweep. If no two suitable controls are known, report **virtual integration verified; real modulation pending owner hardware validation**. Do not halt this virtual release for unavailable hardware.

---

## 10. Deliverables and documentation

Commit functional implementation and tests plus:
- SESSION-5-DIRECTION.md — short up-front design and architectural tradeoffs.
- SESSION-5-PROGRESS.md — per-gate checkpoint log, including actual command results and commit SHAs.
- SESSION-5-RESULTS.md — implemented features, actual test/CI numbers, safety review, screenshots if available, explicit known limits, virtual-vs-hardware evidence and owner acceptance checklist.
- README.md and ARCHITECTURE.md — concise and accurate new flow/model/API/transport contract.
- Synthetic demo Texture/fixture available without real pedals.
- Draft PR titled **Session 5: First Playable Whole-Rig Instrument**, targeting main, with detailed test results and deferred capabilities.

Do not rewrite the Creative Instrument Vision to claim that future Movement/Transition/Experiment Lab is implemented. No media/manual licenses or credentials in commits.

---

## 11. Autonomous execution protocol

Execute reconnaissance → a focused plan → implementation P0–P4 → deterministic safety tests → browser use → adversarial review → full GitHub CI on final head → draft PR handoff.

Make ordinary bounded implementation decisions independently. Commit coherent increments, update Progress regularly, inspect test failures and fix them rather than explaining them away, then rerun the full pipeline. If a helper reviewer/tool is available, seek independent scrutiny specifically on scheduler races, port ownership, session lease, accidental sends, model migrations and hardware claims. If not, record the adversarial self-review honestly.

**Do not stop after writing a plan, opening a PR, or completing P1/P2.** Keep building until the complete vertical slice and all acceptance criteria are satisfied or a genuine safety/platform blocker is documented. Do not simulate CI success, interpret an earlier commit's checks as final success, suppress failing tests or quietly reduce scope.

No auto-merge, no force-push main, no unrelated infrastructure/dependency migrations. The owner retains merge authority.

---

## 12. Explicit end conditions (Claude Code must use these)

### SUCCESS — stop only when ALL are true

1. The actual, integrated application lets a musician author and persist a named **Texture**, route a macro to two CC destinations on different modeled pedals with independent opposite ranges, modulate it from a tempo-related LFO, preview without sends, explicitly connect/arm/Start, see bounded virtual changes, Stop safely and reload the musical idea.
2. All domain, transport, lease, route/CC eligibility, race/cancellation and data compatibility acceptance tests in §9 are implemented and pass, without Session 4 safety regressions.
3. **Backend tests + Ruff, frontend lint/typecheck/build and full Playwright E2E are GREEN in GitHub Actions on the final PR HEAD**. Report links and real counts.
4. All requested code/tests/docs, including Direction, Progress, Results and README/Architecture, are committed. A **draft PR** against main exists and is left **UNMERGED**, ready for owner review.
5. The agent returns a short truthful handoff: PR URL, last commit, completed user workflow, exact CI, known limitations, owner physical validation steps and deliberately deferred features.

### SAFE BLOCKED STOP — acceptable only when

A hard repository/auth/platform restriction, an unresolved serious safety defect, or an indispensable external hardware/proprietary dependency prevents required functionality *and cannot reasonably be bypassed with virtual testing*. Preserve progress on the feature branch, leave a draft PR if possible, write the exact blocker and smallest owner action, and **do not** claim full success. Do not stop because an ordinary test initially failed or the task is nontrivial.

### MERGE GATE

Only the owner may authorize merging after reviewing the draft PR. Claude Code is not authorized to merge it.

---

## 13. First actions for Claude Code

1. Verify current main and a clean git working tree. Read this charter and the full creative vision.
2. Branch **experiment/session-5-creative-instrument** from up-to-date main (including PR #4 and this document). Protect original rigs/profiles/assets/credentials.
3. Run baseline tests and record results. Write Direction and a checkpoint ledger.
4. Implement the specified P0–P4 gates, test and self-review through the end conditions; continue autonomously across normal failures/corrections.
5. Publish a draft PR for owner review, report green checks **on its final commit**, and leave it unmerged.

**Guiding question:** Does Signal Loom now let a guitarist **play the entire rig as one evolving musical instrument**, while staying just as trustworthy, reversible and fail-closed as our verified Session 4 live-control foundation?
