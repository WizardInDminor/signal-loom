# ML10X native adapter architecture (design, 2026-10-24)

**Status:** design proposal, Team B. Nothing in §§3–6 is implemented; only the Backup File Adapter's
*preservation* subset (§3.A) exists on `main` after the ML10X Native Integration V2 slice. No part of this
document authorizes transmitting SysEx, reading a device, or writing device memory.
**Evidence base:** [`docs/research/ml10x-integration-2026-10-23.md`](../research/ml10x-integration-2026-10-23.md)
(third-party captures and editor-bundle reading, not owner-observed), [`docs/morningstar-bridge.md`](../morningstar-bridge.md).
**Code today:** `backend/app/morningstar/ml10x_native.py` (snapshot + interpretation), `ml10x_propose.py`
(routing-free proposals), `backend/app/domain/ml10x.py` (topology), `backend/app/models/rig.py`
(`Ml10xPreset`, `Ml10xConfig`), `backend/app/domain/compiler.py` (`_compile_ml10x`).

## 1. Why a layered design

The research established that the ML10X stores one routing in three forms: the device's internal
`matrixArray` (undecoded columns, present in editor backups), explicit `[from, to, flag]` connection
records (on the wire only, never exported), and the editor's `target ← source` Advanced write form.
Signal Loom already represents routing a fourth way: `Ml10xPreset.chain` / `advanced_edges` on top of a
physical `Ml10xTopology` derived from cables. If any one of these is allowed to leak into another layer,
the product ends up guessing bytes. The design therefore fixes a **semantic model** in the middle and makes
every device-specific form an *adapter* with its own evidence level and its own acceptance tests.

```
Signal Loom Routing Intent  (Scene / Texture / Instrument Studio — Team A surfaces)
          |
          v
Semantic ML10X Routing Model  (§2: Ml10xPreset + topology facts, transport-agnostic)
          |
          v
Topology / Capability Validator  (§2.3: cables, firmware gate, Simple/Advanced, Persist)
          |
          v
Device-Specific Adapter  (§3)
          |
          +---- A. Backup File Adapter      (reads/writes editor Device Backups)
          |
          +---- B. Native SysEx Adapter     (future: connection records over USB)
          |
          +---- C. State Reader             (future: guarded readback)
          |
          +---- D. Device Session Manager   (future: port ownership, lifecycle)
          |
          v
Proposal / Confirmation / Verification  (§4: preview → audition → save → read back → restore)
```

Rules that hold at every arrow:

1. **Downward only produces proposals.** No adapter output reaches a device without the §4 workflow.
2. **Every value crossing an arrow carries its evidence level** (`documented`, `third_party`,
   `third_party_capture`, `owner_observed`, `unknown`), exactly as the Bridge's interpreted layer does today.
3. **Opaque bytes travel opaque.** A `matrixArray` the adapter cannot decode is carried verbatim or the
   operation is refused; it is never "repaired".
4. **Readback is not commanded state.** The State Reader's output is a separate fact from what any adapter
   sent (see the Verification Register's evidence categories).

## 2. Semantic ML10X routing model

### 2.1 What exists and is kept

`backend/app/models/rig.py` already has the shape the semantic model needs; this design proposes **no new
top-level data model**:

| Need | Existing representation | Gap |
|---|---|---|
| Simple serial chain | `Ml10xPreset.chain: list[int]` (loops 1–10 = A Tip … E Ring) | none |
| Advanced routing graph (branches, merges) | `Ml10xPreset.advanced_edges: list[[from, to]]` with nodes `IN`, `OUT`, `IN_TIP`, `IN_RING`, `OUT_TIP`, `OUT_RING`, `L1`–`L10` | validator should reject edges the device cannot express (the wire never emits Input Ring gn 1 or Output Tip gn 2 *as segments*; sources are the 12 non-output connectors, targets the 12 non-input connectors) |
| Input / Output Tip and Ring | the four `IN_*` / `OUT_*` nodes; `IN` / `OUT` as the mono shorthand | none |
| Ten mono loops | `specs.ML10X_LOOPS` | none |
| Stereo associations | `Ml10xLoopAssignment.stereo_pair_with`; `Ml10xTopology.stereo_pairs` from cables | none |
| Explicit bypass intent | `Ml10xPreset.bypassed_loops` (Simple presets; editor-saved states) | the file's `bypass` bitmap layout and the record flag's meaning on output hops are **unverified** (S8-E02); the semantic field is intent, not an encoding |
| Spillover targets | **absent** | add `spillover_tip` / `spillover_ring: int | None` (loop number) once the `tipT`/`ringT` code table is confirmed in a real file (S8-E02); until then the Backup adapter only carries the raw code |
| Mode | `Ml10xPreset.mode` | none |

Two facts belong on the **instance / controller configuration**, not on presets, and are the subject of the
[compiler safety note](../engineering/ml10x-compiler-persist-safety-note.md): `loop_bypass_persistent`
(declared, with the backup's `controllerData.loopBypassPersistent` as an *imported observation*) and
`firmware_build` (the exact dated `.hex`, since v1.2 behaviour changed between 2024-11 and 2026-10 builds).

### 2.2 Identity of a preset

Slot identity is `(bank 0–3, preset 0–127)`; `presetNumber` always equals the array position in the one real
backup and is the only identity field the Backup adapter rewrites. The semantic model's `Ml10xPreset.number`
is the global 0–511 index (`bank * 128 + preset`), already used by the compiler. Adapters translate; they do
not store both.

### 2.3 Topology / capability validator

Composes the existing checks and adds the missing gates, in this order, each yielding `Diagnostic`s:

1. **Physical:** every loop the preset routes through is fully cabled (`preset_diagnostics`); stereo pairs
   consistent with `stereo_pairs`.
2. **Device grammar:** Simple chains have no duplicate loops; Advanced graphs use only expressible edges;
   a merge into the same output connector is an averaging merge (documented behaviour), flagged as info.
3. **Firmware gate:** `specs.ml10x_feature_gate(firmware)`; Advanced per-loop bypass only on v1.2 builds,
   CC control of Advanced loops stays unsupported.
4. **Persist gate:** when `loop_bypass_persistent` is on or unknown, any claim that a preset recall yields
   known loop states is downgraded to a warning (see the safety note).
5. **Name and limits:** ≤12 bytes safe, 13–16 characters with explicit consent, printable ASCII only.

The validator is pure and transport-agnostic; the same diagnostics gate the Backup adapter today (in the
form of refusals) and would gate a SysEx write tomorrow.

## 3. Adapters

### A. Backup File Adapter — partially implemented

| Capability | Status | Where |
|---|---|---|
| Read a Device Backup, verify hash, list unknown keys, interpret with evidence | **implemented** (Session 7) | `ml10x_native.load_native`, `interpret`, `inspect` |
| Structural empty-slot rule (factory payload, never the name alone) | **implemented** (V2) | `ml10x_native.slot_occupancy`, `ml10x_propose._EmptyRule` |
| Rename / copy / move / swap whole presets, connector names; atomic transaction; hash recomputed; byte-identical no-op; self-verified preservation | **implemented** (V2), **editor- and hardware-unvalidated** | `ml10x_propose.propose`, `POST /api/morningstar/ml10x/propose` |
| Change MIDI channel, Device ID, Input Split, Persist, trails | deferred: global operational settings need their own gate and an owner checklist | — |
| Change `tipT` / `ringT`, `bypass` | **blocked** until S8-E02 confirms the file encodings | — |
| Author or alter `matrixArray` (new chains, added loops) | **blocked** (`F-Q14`): columns undecoded; needs S7-E03 pairs and/or an S8-E04 dump, then round-trip validation | — |
| Restore a file to the device | **never** from Signal Loom; the official editor does it; a "full" restore may replace all 512 presets and controller settings (S8-E01 characterizes what it sends) | — |

The adapter's contract: *input* = file text; *output* = `{text, diff, effects, preservation, identity,
evidence}` or a refusal with diagnostics; never a partial file; never a device action.

### B. Native SysEx Adapter — future, third-party protocol evidence only

Converts a validated semantic preset into the device's **explicit connection records**, so that the device
rebuilds its own matrix and Signal Loom never authors `matrixArray`:

- Frame `F0 00 21 24 07 00 P1..P8 L1 L2 <segments> CS F7`, segment `7F <id> <len> <bytes>`, checksum XOR of
  all bytes from `F0` to before the checksum masked `& 0x7F`, outbound `L1 L2 = 00 00`, inbound length
  encoding with the editor's retry on mismatch (`P2=126`).
- Simple write `f1=6 f2=0 P3=127`: one segment per source connector keyed by **groupNumber** (A Tip 4, A Ring
  9, B Tip 5, B Ring 10, C Tip 6, C Ring 11, D Tip 7, D Ring 12, E Tip 8, E Ring 13, Input Tip 0, Input Ring 1,
  Output Tip 2, Output Ring 3), `[from, to, bypass]` when linked, `[gn, 0x7F]` when not, **order-sensitive**
  (unrouted first in `4 9 5 10 6 11 7 12 8 13 3 0`, then routed in chain order); Input Ring gn 1 and Output Tip
  gn 2 are never emitted as segments and the device rejects messages that include them.
- Advanced write `f1=6 f2=2 P3=127`: one 1-byte segment per edge, id = target gn, data = source gn; segment 18
  muted-switch option; segment 19 `bypassLoopStatus` (3 × 7-bit bytes); name ≤12 bytes.
- Acknowledgement `f1=1 f2=2` within ~35 ms; **no echo** of the saved preset, so verification is a navigate
  plus a read (§3.C).

Design constraints that are **not negotiable** in a future implementation:

1. **Strict opcode allow-list** `{0, 24, 19, 21}` (connect), `{22, 18}` (navigate), the two write forms; the
   `P2=32` "Paste Preset to all banks" hazard and every unlisted code are refused at the encoder, not just the UI.
2. **`P3=127` writes whatever slot is current**: the adapter must read the current slot and compare it with
   the intended slot immediately before writing; mismatch aborts.
3. **`P3=0` is not a live-apply primitive** until S8-E03 proves it does not write memory; the adapter has no
   "audition" path until then (§4).
4. Input Split on the captured rig means the Input Ring-as-source form was never observed: the encoder refuses
   presets that route from Input Ring until a capture exists.
5. Two numberings (`value` ids 0–13 for files and controller segments, `groupNumber` for preset records) are
   kept as two explicit tables; a wrong table silently targets the wrong loop.

All of the above is **THIRD-PARTY-CAPTURE / THIRD-PARTY-SOURCE** evidence (one rev-B unit, firmware v1.2,
May 2026). It is not the owner's device and may differ by firmware build.

### C. State Reader — future, guarded

Observes, never commands: current bank and preset, controller data (`f1=6 f2=1`), the active preset's records
and matrix (`f1=6 f2=0`), bank preset names (`f1=6 f2=2`). Two hazards shape it:

- The connect handshake streams every message **twice** and the first preset copy can be a stale stub; the
  reader keeps the last copy or re-reads after an explicit navigate.
- **Navigating changes the live audio path** (relays, LEDs). A reader that enumerates slots is therefore a
  hardware-risk-gated owner session with the amp muted and must end by re-selecting the original slot
  (S8-E04). A reader restricted to the *current* slot and the controller data has no audible side effect
  but still needs port ownership (§3.D).

Output is a `DeviceObservation {when, port, firmware_uuid, bank, preset, records, matrix, controller}` tagged
`owner_observed_readback`, kept apart from both the semantic model and anything the adapter sent.

### D. Device Session Manager — future

Owns one exclusive port (the official editor must be closed; one owner per port, as the Live layer already
enforces for the MC8), the connect handshake with its drain-until-idle timing (1.5 s idle / 6 s max after
connect, 1.2 s / 6 s after a bank change, ≥6 s before trusting the first slots of a new bank), navigate with
retry (2×), acknowledgement waits, read-after-write verification, timeouts, and a **recovery plan** (the
untouched backup, the slot's pre-write readback, the original selected slot). Authorization is tiered:
`observe_current` → `observe_all` (audible) → `write_slot` (memory) → `write_controller` (global), each armed
separately and each disarmed by Stop, port loss or backend shutdown — the same fail-closed posture as the
Session 4 Live layer. This PR implements no port manager; the Live service remains the only MIDI owner and is
untouched.

## 4. Programming workflow (future)

| Step | Meaning | Prerequisite before it can exist |
|---|---|---|
| Preview | semantic preset + validator diagnostics + the exact encoded records, zero sends | nothing (offline) |
| Audition | apply to the device **without saving** | S8-E03 must prove a non-persistent apply exists (`P3=0` hypothesis) **and** that it does not write memory; otherwise this step does not exist and the workflow goes straight to Save with the recovery plan |
| Apply without saving | same as Audition; listed separately only because the research hypothesis must be disproved or proved, not assumed | as above |
| Save to device memory | `P3=127` on the verified-current slot | owner-validated reader (C), session manager (D), untouched full backup, pre-write readback of the slot |
| Verify by reading back | navigate + read, compare records/matrix with the intent and with the pre-write snapshot | reader (C) |
| Restore previous known state | re-write the pre-write readback (same path), or editor restore of the untouched backup | the full-restore characterization (S8-E01) |

The Bridge's existing *propose → review diff → download* flow is the file-adapter instance of
Preview → Save; Audition is deliberately absent.

## 5. Fixture-driven protocol test harness (design)

A pure-Python harness under `backend/tests/ml10x_protocol/` (future) with **no port access**: a `FakeDevice`
that consumes outbound frames and emits scripted inbound frames from JSON fixtures written by Signal Loom
(the third party's GPL fixtures are *not* vendored; its documented facts are used to author independent
fixtures, and the owner's own captures can be added locally, git-ignored).

| Area | Tests |
|---|---|
| Framing and checksum | encode/decode round trip; XOR checksum; 7-bit masking; a frame with a wrong checksum is rejected |
| Inbound length | `L1 L2` decode including the flag bit; mismatch triggers the retry request and no state change |
| Segmentation | `7F id len` parsing; truncated segment; duplicate ids; unknown ids preserved opaque |
| Identifiers | `value` vs `groupNumber` tables; sources 12 non-output, targets 12 non-input; Device ID match |
| Handshake | four connect frames; duplicated stream; stale first preset stub superseded by the second |
| Duplicates and stale replies | reply for a previous navigate arriving after a new one is discarded |
| Connect and loading bursts | up to 256 progress messages; drain-until-idle timers with a fake clock |
| Acks and retries | `f1=1 f2=2` within the window; no ack → no "saved" claim; retry budget 2× then fail |
| Allow-list | every opcode outside the list is refused at the encoder; `P2=32` specifically |
| Navigation | bank change resets to preset 0; the live-audio warning is attached to every navigate |
| Timeouts | fake clock; a hung device leaves the session in `disarmed`, nothing retried blindly |
| Read-after-write | written records equal read records; matrix returned is stored as observation only |
| Wrong current slot | pre-write read shows another slot selected → write refused |
| Unsupported firmware | unknown UUID/firmware marker → observe-only |
| Mid-transaction failure | port loss between navigate and write → no write, recovery plan surfaced |

Each test asserts **both** the bytes on the wire and the resulting authorization state; no test may claim
device behaviour. A passing harness is `SW-PASS` for framing and state machines only.

## 6. What is explicitly not decided here

- Whether the editor's Restore decodes the matrix or uploads raw segments (S8-E01) — it changes whether a
  Signal Loom backup with *new* routing could ever be restored by the editor.
- The matrix column table (S7-E03 / S8-E04) — needed only for authoring routing into *files*; the SysEx path
  does not need it.
- Whether CC 10–29 act on Advanced presets on v1.2 (kept unsupported).
- Factory default MIDI channel and Device ID.

## 7. Verification IDs

Design-only: no new `SW-PASS`. The implemented preservation subset is `S9-S01…S9-S06`; the owner acceptance of
candidate files is `S9-E01…S9-E03`; the future adapters depend on `S8-E01…S8-E04`
([Verification Register](../verification-register.md)).
