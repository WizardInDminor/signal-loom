# Future feature proposals

This document captures product directions worth preserving without placing them in the active
implementation or hardware-validation scope. Entries are **proposed, not implemented or
scheduled**. They do not authorize new MIDI behavior.

## Experiment Mode — serendipitous rig exploration

**Status:** Future feature / product backlog  
**Origin:** Real-hardware MIDI testing, 2026-10-18; captured 2026-10-19  
**Priority:** Unscheduled; do not interrupt deterministic scene administration and hardware
verification.

### Why it exists

During real-device tests, sending loosely chosen Program Change (PC) messages to several
pedals produced one or two unexpectedly compelling **full-rig** combinations, especially for
experimental music. This was not a sound reconstruction or AI tone-inference problem. The
pedals already contained the sounds; exploring combinations revealed possibilities the
musician might not otherwise have selected.

**Product principle:** Make rig administration reliable and nearly invisible, while giving
musicians an intentionally playful place to discover, preserve, and revisit happy accidents.
Normal scene editing and recall must remain predictable. Experimentation must be a
**deliberately entered, visibly distinct mode** rather than a randomize action reachable
through routine state-management controls.

### Candidate musician journey (future MVP)

1. **Enter and arm Experiment Mode explicitly.** Identify eligible MIDI-capable devices,
   valid/known program ranges and preset inventory, and current state confidence. Capture a
   restore point where sufficient state is known. Explain what cannot be restored.
2. **Audition combinations.** Generate eligible per-device preset recall actions (including
   Bank Select when required), show the intended commands and targets, and send only upon a
   deliberate user action. Keep a session-local history of combinations auditioned.
3. **Lock and explore.** Freeze promising devices/presets (e.g., Hedra and MOOD MKII) while
   shuffling only the unlocked devices. Optionally seed exploration from an existing scene.
4. **Capture the discovery.** With one explicit action, create a new **draft scene** from
   the known combination; let the musician name it and add a short note about what made it
   interesting. Never overwrite an existing scene or device preset as a side effect.
5. **Exit intentionally.** Offer to retain the current auditioned state or restore the
   pre-session state **where restoration can be supported**. If the pre-session state was
   partially unknown, warn rather than claiming a complete rollback.

Potential modes after the MVP: full rig shuffle; selected-device shuffle; lock-and-shuffle;
mutate a copied scene; later, narrowly constrained parameter exploration using documented,
verified and safe CC mappings. A searchable **discovery journal** could preserve time,
candidate commands, locked devices, names, notes, and relationships between source scenes
and their mutations. Future looper/audio integration could attach an illustrative musical
performance to a captured discovery; it is not part of the initial feature.

### Isolation and safety requirements

- **Opt-in command boundary.** Exploration commands must use a separately authorized and
  guarded path; normal scene create/edit/recall, preset inventory management, backups, and
  hardware validation must never generate random changes. Reject exploratory sends outside
  an active, armed Experiment Mode session on the backend, not just through UI hiding.
- **Recall, don't write.** First version sends only supported non-destructive preset recalls
  to explicitly selected devices. No random SysEx, device-global settings, MIDI channel
  changes, save/store commands, firmware operations, or arbitrary CC sweeps. Randomize
  *choices from bounded, identified preset candidates*, not unconstrained MIDI bytes.
- **Evidence-aware state.** Distinguish configured/desired, last-commanded and actually
  observed or device-verified state. Successful transmission is not proof of what an external
  pedal did. Unknown state may be auditioned only with clear constraints and should never be
  labeled verified or silently treated as restorable.
- **Explicit scope and user control.** Include per-device eligibility and locks, a command
  preview, conservative send pacing, and a stop/exit control that prevents subsequent sends.
  Stopping commands does **not** undo audio or guarantee hardware rollback. Warn that scene
  changes may abruptly alter loudness, feedback, or effect tails.
- **Non-destructive persistence.** Auditions should not mutate canonical rig configuration,
  saved scenes, preset libraries, or controller mappings. A captured scene enters the existing
  validation/save workflow through explicit user action, with its provenance and any remaining
  unknowns visible.
- **Recovery with truthful guarantees.** Take a pre-experiment state snapshot if possible,
  and offer best-effort restoration only for known, addressable values. Mark unobservable or
  unrestorable aspects clearly; never promise an atomic multi-device rollback.

### What would establish readiness

- Tests demonstrate that exploratory sends are **impossible** from ordinary management
  entry points, including accidental UI or API invocation.
- Auditioning across several real pedals works within documented MIDI ranges and produces a
  visible, attributable command history.
- The musician can lock part of a combination, vary the remainder, and save the result as a
  new scene without altering the original.
- Missing preset inventory and unknown hardware state produce visible limitations, not
  fabricated certainty.
- Exit and restoration have explicit, hardware-tested behavior and honest failure reporting.
- Existing deterministic scenes, backup behavior, tests and normal hardware-validation
  workflows remain unchanged.

### Scope note

**No implementation is authorized by this entry.** Finish current device-profile,
preset-inventory, state-confidence, command dispatch and real-hardware validation work first.
When scheduled, start with a narrow PC-based prototype and review the hardware-safety
boundary before broadening exploration.

---

Other ideas can be added as separate dated entries, with scope and status kept explicit.

## Deferred from Session 5 — the instrument beyond the first Texture

**Status:** Backlog, captured 2026-10-22 at the end of Session 5 (see SESSION-5-RESULTS.md).
**Not authorized to transmit by this entry.**

Session 5 shipped one Texture, one macro, one triangle LFO, two-device opposite ranges, a budgeted
backend performance engine with a browser lease, and a synthetic virtual fixture. Deliberately
left for later sessions, with the seams already in place:

- More modulation sources and shapes (`Lfo.shape` is a one-value literal today), envelopes, step
  modulators, phase relationships and any summing/priority semantics between sources.
- Movements (time-structured development of a texture), Transitions (independently scaled moves
  between textures with per-device jump/hold limits) and Compositions; the engine evaluates a
  `Texture` and knows nothing of scenes or arrangements.
- Per-texture expressive input (one physical expression pedal/footswitch mapped to different
  meanings per texture), MIDI learn; browser Web MIDI is explicitly not the path.
- MIDI Clock out (tempo is an internal reference only), SysEx and read-only identity queries.
- Experiment Lab (above) as an isolated opt-in; nothing random ever enters scenes or performance.
- Coalesced undo/autosave for continuous macro gestures; configurable lease/budget in the UI;
  marking continuous controls hardware-verified from a recorded owner test.


## Official-manual MIDI mapping library (requested 2026-10-22)

**Priority:** High after first Instrument authoring experience; foundational for expressive control, scenes and later preset editing. **Status: first version implemented in Session 6** ([MIDI Knowledge Workbench](midi-knowledge-workbench.md)): source-cited structured controls (behaviour, range, page, default vs remapped, hardware status, review state), Quick Reference notes, page-text proposals that stay *proposed* until reviewed. Still future: extraction beyond the simple "CC nn …" pattern, table-aware parsing, firmware/manual revision tracking per control, structured diff/approve of a whole proposed map. The existing device profile model supports `midi.cc_map`, control `continuous`, commands and evidence, but the app does not yet offer a complete assisted official-manual-to-MIDI-map ingestion and review flow.

Desired workflow: attach or link an official manufacturer manual / MIDI implementation chart in the Device Library, extract the MIDI controls into **proposed** profile entries, inspect/edit a structured diff and approve. Record manufacturer/model, firmware/manual revision where known, source URL or attachment and page, CC number, semantic name, valid range, continuous vs discrete/toggle/unknown, warnings, and per-control provenance. Preserve uncertainty, user edits, and meaningful Scene/Texture links; never auto-promote documented data to physically verified.

Keep a manufacturer's **default mapping** separate from **the user's actual device configuration**. The Source Audio Collider supports global remapping of CC assignments in Neuro; a documented factory CC may not match this particular pedal. Require configuration review and later owner-observed physical verification before marking a hop/control hardware verified. Never infer a safe sweep from an undocumented CC or a bypass/trigger.

First useful targets: Strymon Volante Echo Level CC12 and Source Audio Collider Delay A Mix CC3 are manufacturer-documented **candidates**, not physical hardware-verified. Existing Undertow Texture maps these with opposed ranges. Prioritize complete vendor-sourced, auditable profiles for the actual rig—Volante, Collider, Zelzah, Hedra, MOOD MKII and Sunset—without manufacturing settings the manuals do not establish. Tests should cover provenance, default-vs-custom values, round-trip/import idempotency, safe/unsafe CC classification, legacy data and impact review.

## Hardware pedal preset creation and safe saving (requested 2026-10-22)

**Priority:** After validating the first real Instrument Texture and establishing manufacturer-backed control maps/preset slot knowledge. **Status: proposed, not implemented, no new MIDI write behavior authorized.**

Musician goal: dial in real parameters through Signal Loom, capture a **draft named pedal preset** into a persistent, versioned library, select an *identified and deliberately approved* destination slot, preview the exact vendor-specific save procedure, confirm any overwrite explicitly, save only with deliberate hardware authorization, and verify the outcome wherever feedback is actually possible. Integrate the authored preset with Textures and Scenes without automatically rewriting either.

**Critical distinction:** PC recall is not generally a write operation. Strymon's Volante explicitly documents a *manual* save-arm gesture (hold FAV until blue flashing) followed by MIDI PC to select a location. This cannot be assumed to be an unattended software-only write. Other models may require an editor-specific protocol/SysEx or have no supported remote-saving interface. Each writable device needs a reviewed protocol, firmware notes, the verified route, and owner-led tests. Never invent or blast unknown SysEx, assume readback, or infer that sending means memory changed.

Safety gates: documented slot inventory (factory/user/free/unknown; unknown is **not free**), explicit backup/recovery, state confidence/provenance, destructive-write warning and two-stage confirmation, exact route/slot/message preview, auditing, reject writes during ordinary Scene/Texture editing or continuous performance, and failure recovery without pretending rollback is guaranteed.

Recommended milestones: (1) offline draft preset capture/inventory, (2) one manually assisted safe vendor-specific save, (3) readback/import only where actually supported, (4) broader model adapters and optional multi-pedal programming after independent physical verification. No saving commands should be enabled by this backlog item.


## UX follow-ups observed during owner testing — 2026-10-22

**Status:** Captured for a focused UX/polish pass, **not implemented** and **not part of the ongoing offline Undertow/hardware-validation test**. These observations come from real use of the current app, not an automated regression reproduction.

### UX-ML10X-01 — ML10X preset number entry and unintended movement

**Owner observation:** Editing the Morningstar ML10X preset number is cumbersome: the control effectively forces arrow-by-arrow incrementing rather than direct number entry; while stepping through numbers that are already assigned, the preset can move/reorder with each increment. The behavior when a requested number already belongs to another active preset is confusing. This needs a deliberate, predictable interaction before considering the ML10X planning workflow polished.

**Desired behavior and acceptance:**
- Permit direct typed entry (and normal keyboard shortcuts), with a clear valid range and consistent display numbering versus MIDI wire numbering.
- **Separate editing a desired preset number from committing a move**. Intermediate typing, focus changes and arrow increment steps must not repeatedly reshuffle active preset assignments.
- Detect occupied numbers before applying; show an explicit conflict with a comprehensible choice (cancel, swap, choose another slot, or another deliberately designed rule). Never silently overwrite or move a different active preset.
- Make current vs proposed assignment visible, with clear Save/Cancel or explicit commit semantics; preserve stable IDs and unrelated assigned preset positions.
- Add UI regression tests for direct entry, stepping across occupied numbers, duplicate assignments, undo/save/reload and export consistency; verify no unintended MIDI or hardware programming.

**Priority:** High UX correctness for the ML10X planner. Investigate actual control/component implementation before choosing fix.

### UX-LIBRARY-01 — Device Library search drops its filter intermittently

**Owner observation:** While a term remains entered in the Device Library search field (example shown: `Mood`), the list sometimes reverts to displaying the full imported catalog. Removing and retyping one letter usually refreshes the filtered results. Screenshot observed a populated input and unrelated alphabetical results simultaneously. The query should never be silently discarded.

**Desired behavior and acceptance:**
- The visible list consistently reflects the visible search query, including during rapid typing, navigation, profile selection, saves and async catalog refreshes.
- Diagnose whether state restoration, query filtering, stale request responses, pagination or rerendering caused the intermittent reset; do not assume the root cause from the screenshot.
- Ensure out-of-order async responses cannot overwrite newer query results; provide predictable clear/reset, loading and zero-results states.
- Add reliable browser regression tests for typing/pasting `Mood`, typing quickly, deleting/readding a character, switching a profile, returning from Edit, and triggering data refresh while a query remains set.
- Avoid loading/re-rendering thousands of irrelevant results while a valid filter is active. Preserve keyboard focus and input value.

**Priority:** High polish/usability; keep distinct from MIDI/hardware correctness.

### Additional workflow observations (existing requests)

- **UX-MANUAL-01:** Two vendor MIDI guides were uploaded and one relevant continuous CC per pedal was manually inserted in full-profile JSON to prepare the Undertow Texture. Both controls became `documented continuous` without claimed hardware verification. This proves the data model works, but the upload → JSON edit → refresh workflow is too clerical for a creative instrument. **Addressed in Session 6:** the Knowledge Workbench enters controls beside the manual with no JSON; verification **F-Q08** stays partial until controls are physically checked.
- **UX-INSTRUMENT-01:** Functional grouping still shows Volante, Collider, Zelzah, Hedra and MOOD MKII as `Other` on the existing rig. Per-Texture roles are editable, but classification/onboarding could suggest meaningful multi-role categories without misrepresenting audio topology. Keep this a future interface refinement; don't block the offline Texture test. Existing macro-undo coalescing remains **F-Q02**.

**Scope discipline:** These are future implementation inputs, not authority to add new live MIDI commands or hardware preset writes. Preserve the user's present Texture, manufacturer-sourced CC entries, attached manuals and physical evidence flags during a future polish pass.


## Deferred from Session 6 — the Knowledge Workbench beyond the first slice

**Status:** Backlog, captured 2026-10-23 at the end of Session 6 ([design and delivery note](midi-knowledge-workbench.md)). **Not authorized to transmit by this entry.**

- Contextual Quick Reference: show a pedal's pinned *presets* note inside the preset/program editor and the *midi_setup* note next to the channel field (the data and the pin are in place; only the surfaces are missing).
- Smarter extraction: table-aware parsing of MIDI charts, a whole-map structured diff with approve/reject per row, firmware and manual revision per control, OCR for scanned manuals (the current proposals read only the page's own text layer).
- Reference viewer: text selection and highlight on the page picture, annotations, bookmarks per document, a thumbnail strip, semantic search across all manuals of a rig.
- Notes: light formatting (lists, bold), images, links between notes and controls, a rig-wide "stage card" of pinned notes.
- Program Change and bypass knowledge in the same editor (today they stay in the full-profile editor), named preset inventories per pedal (prerequisite for safe preset saving, F-Q09).
- Owner-side: physical verification per control from a recorded test (S6-H01/H02), and surfacing the per-control hardware status in the Live coverage view.
