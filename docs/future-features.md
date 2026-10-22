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
