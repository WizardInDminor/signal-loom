# ML10X compiler: Loop Bypass Persist and memory-write safety — follow-up design note

**Status:** analysis and proposed follow-up (Team B, 2026-10-24). **No compiler, schema or live-transport code
was changed** in the ML10X Native Integration V2 PR: the scene compiler, `models/rig.py`, the Device Library
contracts and the Live layer are cross-team contracts. This note is the input for a separately scoped issue.
**Evidence:** [`docs/research/ml10x-integration-2026-10-23.md`](../research/ml10x-integration-2026-10-23.md) §3
(DOCUMENTED release notes and help article, FORUM-STAFF for CC#50), `backend/app/domain/compiler.py`
(`_compile_ml10x`), `backend/app/morningstar/specs.py` (`ml10x_feature_gate`).

## 1. What the compiler assumes today

`_compile_ml10x` (compiler.py, lines ~367–490) compiles a Scene's `ml10x.preset_number` into **CC#0 = bank**
then **PC = preset** and explains the pair as *absolute state*: "so that the following PC lands in the right
bank regardless of prior state". Loop states (`scene.ml10x.loop_states`) compile into **CC#10–19 absolute
values** (0 = bypass, 127 = engage), gated by `ml10x_feature_gate(firmware)` (Advanced presets: ERROR
`ml10x.loop_cc_advanced_unsupported`) and by chain membership (WARNING `ml10x.loop_not_in_preset`).

The implicit claim: *after bank + PC, the device's loop engage/bypass states are the ones saved in the preset*,
so the Scene's loop CCs only need to cover the deltas it cares about, and a Scene that sets no loop state has
nevertheless put the rig into a **known** routing-and-bypass state.

## 2. The mismatch with the October 23 research

| Fact (status) | Effect on the compiler's claim |
|---|---|
| **Loop Bypass Persist ON**: a preset load "sets up the signal chain, then sets each loop's state — this step is IGNORED if Loop Bypass Persist = ON" (DOCUMENTED help article). The preset re-orders the chain; each loop keeps whatever engage/bypass state it had before. | Bank + PC establishes the **routing** but **not the loop states**. The compiled plan's "absolute state" is false for every loop the Scene does not set explicitly. A Scene that only recalls a preset inherits unknown bypass states from the previous Scene or from manual footswitch presses. |
| Persist "may turn on by itself after the v1.2 update" (OFFICIAL-REPO pre-update warning); after backup → factory reset → restore users saw every loop stay engaged regardless of preset (FORUM) | The setting can change without the musician knowing; it must be treated as **unknown unless declared or imported** from a backup (`controllerData.loopBypassPersistent`). |
| Advanced presets: per-loop bypass saved in the preset only on v1.2 builds (DOCUMENTED, beta); whether CC#10–29 act on Advanced presets is contradicted (FORUM-STAFF vs FORUM-USER) | Already handled: `advanced_mode_cc_bypass = False` → ERROR. Keep. |
| Firmware changed behaviour across dated v1.2 builds (2024-12-06 Advanced bypass on load; 2025-11-24 CC#51 and boot states with Persist on; 2026-06-30 Menu+Select saves bypass; 2026-08-28 fix for Input/Output engaging on load with Persist on) | `firmware_version` "1.2.0" is not specific enough to reason about these; the **dated build** matters. |
| **CC#51** reloads the current preset's saved loop states (DOCUMENTED, 2025-11-24 build) | A documented way to re-establish the preset's saved states even with Persist on — but only on builds ≥ 2025-11-24 and only "saved states" (unknown for Advanced presets on older builds). Candidate for an explicit, declared-capability compiler step; **not** to be emitted by default. |
| **CC#52** saves the *current* loop bypass status **into preset memory** (DOCUMENTED; rate-limited once / 5 s). Menu + Select does the same from the device. | A **memory write triggered by MIDI**. Must never be reachable from a Scene, Texture or live control path without a separate memory-write authorization gate. |
| **CC#50** sets Loop Bypass Persist on/off (FORUM-STAFF: >63 on, ≤63 off); persistence of the setting itself is not established | A **global configuration change**, not a performance gesture. Must never be emitted as an ordinary Scene message. |
| CC#30–39 output cut (64 toggle, 0 restore, 127 cut), CC#40–43 input/output tip/ring bypass (64 = toggle; other values' meaning not stated) | Toggles are **not idempotent**: a repeated Scene recall flips state. These must not enter absolute-state Scene compilation; if ever supported, only with a documented non-toggle value and a verified readback story. |

**Precise statement of the defect:** with Persist ON (or unknown), the compiled ML10X part of a Scene is
*routing-complete but bypass-incomplete*; the plan nevertheless describes itself as absolute and the Stage /
Live views present the resulting loop states as known. Nothing today tells the musician that the loop states
after recall are inherited.

## 3. Where each fact should live

| Fact | Proposed home | Why |
|---|---|---|
| Firmware **build** (dated `.hex` name) | `Ml10xConfig.firmware_build: str | None` beside `firmware_version`; declared by the owner (device menu or the file flashed); evidence `user_declared` | Behaviour differs between v1.2 builds; `firmware_version` alone cannot gate CC#51/CC#52 semantics |
| **Loop Bypass Persist** | `Ml10xConfig.loop_bypass_persistent: bool | None` (declared) **plus** an *imported observation* from a Device Backup (`controllerData.loopBypassPersistent`, evidence `backup_import`, with the file's `downloadDate`). `None` = unknown = treated as ON for safety | It is device configuration, not Scene intent; it can change outside Signal Loom |
| Known vs unknown loop states after a recall | A new field on the **compiled plan**, not on the rig: `ScenePlan.ml10x_state_confidence` per loop (`saved_in_preset` / `set_by_cc` / `inherited_unknown`) | The compiler already owns "what the device state will be"; the Stage and Live views read it |
| Verified bypass capabilities per firmware | `specs.ml10x_feature_gate` extended with `reload_saved_states_cc51: bool` (build ≥ 2025-11-24), `save_states_cc52: bool` (memory write; never auto-emitted), `advanced_bypass_on_load: bool` (build ≥ 2024-12-06) | Keeps capability facts in one evidence-tagged place |
| Simple vs Advanced of the selected preset | already `Ml10xPreset.mode` | — |
| Whether explicit CCs can establish the desired state | compiler diagnostics: Simple + loop in chain → yes (CC#10–19); Advanced → no (unless the gate says otherwise after owner verification); Persist ON + no explicit CC → `inherited_unknown` | Already partly there; needs the Persist branch |

## 4. Audit: can arbitrary device-specific CC values reach the normal paths?

- **Scenes:** `DeviceSceneState.cc_values` are free CC number/value pairs per *pedal* instance; the ML10X is
  addressed only through `Ml10xSceneState` (preset number + loop states) and compiled to CC#0, PC and CC#10–19.
  A user could, however, place the ML10X as an ordinary MIDI device instance with a profile and author
  `cc_values` for it — then **CC#50 / CC#52 / CC#30–43 would compile and transmit like any pedal CC**. No
  profile-level deny-list exists for "configuration" or "memory-write" CCs.
- **Textures / Instrument Studio:** modulation is limited to controls marked continuous and reviewed
  (Session 6 rules: a `proposed` control is never eligible; toggles/triggers are refused as switches). CC#50/52
  would only be reachable if someone declared them as continuous reviewed controls, which the Workbench UI
  allows for any CC number. The guard is procedural, not structural.
- **Live capture / replay** (Session 4): replays last-sent intentions; it does not filter by CC meaning.

Nothing in the current demo rig or shipped profiles emits CC#50/51/52, and the ML10X profile has no such
controls. The hazard is latent, not active. It still needs a **structural** separation, because the Vision
document's safety rule ("disallow bank select, preset writes, resets, vendor-global settings … unless a
separately reviewed adapter explicitly permits") is today enforced only by what the shipped profiles contain.

## 5. Required safety separation (proposal)

Three message classes with three gates, independent of transport:

| Class | Examples (ML10X) | Gate |
|---|---|---|
| **Ordinary performance control** | CC#0 bank, PC, CC#4, CC#5–9, CC#10–29 (Simple presets) | existing Live arm/start; Scene compile |
| **Global configuration change** | CC#50 Persist, Device ID / MIDI channel changes (editor/SysEx), Input Split | separate `configuration_change` authorization per message, never from a Scene/Texture, with a before/after readback or an explicit owner checklist step |
| **Persistent memory write** | CC#52 save bypass status, SysEx preset write (`P3=127`), controller-settings write, editor restore | separate `memory_write` authorization, untouched backup required, read-after-write verification, never reachable from compile/replay/modulation |

Implementation sketch (file level) for the follow-up issue:

1. `backend/app/morningstar/specs.py`: add `ML10X_CC_CONFIG = {50}`, `ML10X_CC_MEMORY_WRITE = {52}`,
   `ML10X_CC_TOGGLE_ONLY = {20..29, 30..43}` (toggle semantics / non-idempotent) with evidence notes; extend
   `ml10x_feature_gate` as in §3.
2. `backend/app/models/rig.py` (**shared schema — Team A/B coordination**): `Ml10xConfig.loop_bypass_persistent:
   bool | None = None`, `Ml10xConfig.firmware_build: str | None = None`. Default `None` keeps every existing
   document valid (StrictModel + defaults; add a load test for a Session 7 export).
3. `backend/app/domain/compiler.py` (**shared — coordination**): in `_compile_ml10x`, when
   `loop_bypass_persistent is not False`, emit WARNING `ml10x.persist_inherits_loop_states` ("recall sets the
   chain; loop engage/bypass states are inherited unless this Scene sets them") and record per-loop confidence;
   change the CC#0/PC explanation from "absolute state" to "bank and preset; loop states: see diagnostics".
   Refuse (ERROR `midi.cc_memory_write_in_scene`) any compiled CC on a switcher instance whose number is in
   `ML10X_CC_MEMORY_WRITE` or `ML10X_CC_CONFIG`, and WARN on `ML10X_CC_TOGGLE_ONLY`.
4. A **profile-level** deny-list hook for any device: `DeviceProfile.midi.unsafe_ccs` (config / memory-write
   classes) consulted by the compiler, the Texture eligibility check and the Live replay path — so the
   separation is structural for every pedal, not ML10X-specific. (Device Library contract — Team A.)
5. Frontend (Team A surfaces): show the per-loop confidence on the Stage and in Live coverage; a Persist
   banner on the ML10X controller panel with its source (declared / imported from backup / unknown).
6. Tests: compiler cases Persist OFF / ON / unknown × Simple / Advanced × with/without explicit loop CCs;
   refusal of CC#50/52 authored on a switcher instance; profile deny-list applied in compile, Texture
   eligibility and replay; schema backward-compatibility load of an older export.

## 6. Is anything immediately dangerous?

No shipped path emits CC#50/51/52 or any ML10X SysEx today; the demo rig and built-in profiles do not contain
them, and the Bridge is offline. The smallest **separately reviewable** safety fix, if the owner wants one
before the full follow-up, is item 3's refusal of memory-write / configuration CCs on a switcher instance plus
the Persist warning — a compiler-only change with its own tests and no schema change (the Persist value would
be read from a new optional field or, until then, treated as unknown). This PR does not include it, because
the compiler is a cross-team contract.
