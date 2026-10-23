# Morningstar ML10X — integration research (2026-10-23)

**Purpose.** Everything found about the ML10X that bears on backing it up, restoring it, and writing
to it from Signal Loom, with a focus on **how the pedal represents and saves routing**. This page
supersedes the routing sections of `raw-ml10x.md` (2026-10-15) where they conflict; the older page
stays as the record of what was known then.

**Nothing in this page is hardware-verified by the owner.** Every claim carries one of these tags:

| Tag | Meaning |
|---|---|
| **DOCUMENTED** | Official Morningstar material: GitHub release notes, or search-engine excerpts of help-centre / manual pages. The sandbox again could not open `help.morningstar.io`, `manuals.morningstar.io`, `forum.morningstar.io`, `editor.morningstar.io` or the Atlassian wiki; `github.com` worked. Each excerpt is a one-click confirmation away. |
| **FORUM-STAFF / FORUM-USER** | Statements on the Morningstar forum, as quoted by search excerpts. Staff posts are strong, user posts are anecdotes. |
| **THIRD-PARTY-SOURCE** | Read by a third party (`ragb/ml10x-access-rs`, GPL-3.0) from the official editor's JavaScript bundle. Strong for *format*, says nothing about *device behaviour*. |
| **THIRD-PARTY-CAPTURE** | Real USB MIDI traffic between the official editor and one rev-B ML10X on firmware v1.2 (May 2026), published as JSON fixtures in that repository. |
| **LOCAL-ANALYSIS** | This session's own reading of those fixtures (scripts in the session scratchpad, results reproduced below). It is only as good as the captures. |
| **UNVERIFIED** | Hypothesis, contradiction, or simply not found anywhere. |

Licensing: the third-party repository is **GPL-3.0**. Its facts are used; its code and fixtures are
**not** copied into Signal Loom. The one real backup file it contains is downloaded locally for the
existing reader test and stays git-ignored (`backend/tests/fixtures/external/`).

---

## 1. Summary for the impatient

1. **The backup file does not contain the routing in a form anyone can read or write.** An editor
   *Device Backup* stores each preset's routing only as `matrixArray` (16 rows × 3 bytes), a copy of
   the device's internal crosspoint/mux image. The rows are now **labelled by the device itself**
   (§5.3), but the column bits are still a per-source lookup that no public source has decoded
   (§5.4). Writing *new* routing into a backup file therefore remains **blocked** (`F-Q14`).
2. **The wire protocol carries routing explicitly, and it is written without the matrix.** Over USB
   SysEx the device sends `[from, to, bypass]` records per source connector, and the editor writes a
   preset with the same records (Simple) or `target ← source` pairs (Advanced); the device rebuilds
   its matrix. A third party has verified this end to end on one device: Simple and Advanced writes
   acknowledged, full 512-preset dump, byte-exact round trips against the official editor (§6).
   **This is the realistic path to "writing to the pedal"**, and it is a hardware-risk-gated path.
3. **A wire dump also pairs every preset's records with its matrix.** Reading the owner's own device
   once would yield, for every used preset, both the explicit routing *and* the matrix bytes, which
   is exactly the evidence a `matrixArray` decoder needs (§5.5). No editor experiments required.
4. **Backup files can be edited safely where the matrix is carried verbatim.** Renames, controller
   settings, spillover, and **moving or copying whole presets between slots and banks** (the
   `UX-ML10X-01` pain point; the editor gained copy/paste only in 2025 and fixed it for banks 2–4 on
   2026-10-01) only need the hash recomputed (§4.3). Still editor-unvalidated; restore semantics are §4.4.
5. **Firmware v1.2.0 is still the "BETA" pre-release but is the actively maintained line** (builds
   dated 2026-06-30 … 2026-10-01); v1.1.2 (2024-11-20) remains tagged "Latest". The v1.2 CC map
   (30–43, 50–52) is now DOCUMENTED from the release notes, which also settles the CC#30–39
   polarity (§3).

---

## 2. Device and firmware facts (updates to `raw-ml10x.md`)

| Fact | Status |
|---|---|
| Hardware: 5 TRS send/return pairs = 10 mono loops (Tip/Ring), stereo TRS In and Out, 14 programmable connectors, 5-pin MIDI In + Thru, USB-C, 9–18 V DC ≥160 mA. Unchanged. | DOCUMENTED (prior page) |
| **Rev-A vs rev-B.** Units sold from September 2023 (enclosure marked "rev b", horizontal USB-C) use a different processor and need the `REV_B` firmware file. The owner's unit enumerates as `Morningstar ML10X revb` (dated report 2026-10-18), so it is a rev-B. | DOCUMENTED (release notes) + owner port name |
| **Firmware releases** on `github.com/Morningstar-Engineering/ML10X`: v1.1.1 tag `v1.1` (2022-11-14, "Initial release"); **v1.1.2** (2024-11-20, tagged *Latest*: display fixes for CC/ML10X-message loop toggles); **v1.2.0 (BETA)** pre-release, tag `v1.2`, last updated 2026-10-02, with ten dated `.hex` builds for REV_A and REV_B from `2026-06-30_…_260630549` to `2026-10-01_…_261001541`. | OFFICIAL-REPO (releases page + atom feed + asset list) |
| v1.2.0 dated changelog, newest first: 2026-10-01 fix preset copy in banks 2–4; 2026-08-28 fix Input/Output engaging on preset load in Simple mode with Loop Bypass Persist on; 2026-08-07 re-initialise the chip when 9 V arrives after USB-only power; 2026-06-30 **Menu + Select saves the current loop bypass status to the preset**; 2026-03-27 fix "last connected" trails and the ML10X message type on rev-A; 2025-11-24 CC#51 reload loops and first-boot bypass states with Persist on; 2025-10-16 button sensitivity; 2025-02-07 Advanced-mode fix; 2025-01-10 editor copy/paste; 2024-12-10 CC#40–43; 2024-12-06 Advanced-mode loop bypass on preset load and trails in Advanced mode; 2024-11-22 Loop Bypass Persist, Input Ring split, Advanced bypass/engage, renaming of inputs, outputs and send/return ports. | OFFICIAL-REPO |
| Pre-update warnings for v1.2: connector names shift after updating from v1.1 (re-enter them); Loop Bypass Persist may turn on by itself after the update and then stops saved preset bypass states from loading; use the **beta editor** (`editor-beta.morningstar.io/ml10x`). | OFFICIAL-REPO |
| Manual position on v1.2: a beta "in the final stages of testing" allows engage/bypass of loops in Advanced presets, "not recommended for gigging until the stable release". | DOCUMENTED (excerpt) |
| Forum: Advanced-mode bypass commands froze a unit on a later beta build (user); an Advanced preset recalled by SysEx froze a unit until power-cycle (user). | FORUM-USER |
| Device UUID: sent after connect as 32 nibbles (`f1=17`), e.g. `64fdfbee-2e38-79d7-…`. **Firmware version on the wire: not decoded by anyone** — the editor reads a "firmware version + UUID" message but the third party only recovered the UUID. | THIRD-PARTY-CAPTURE / UNVERIFIED |
| **Factory default MIDI channel and Device ID: still not found.** Menu: *Global Settings → Edit MIDI Channel* (0 = ignore MIDI); *Factory Reset* in the same menu. The one real backup has channel 9, Device ID 6 (user settings). | UNVERIFIED |

---

## 3. MIDI implementation (CC map consolidated)

Per-loop CC control works **only in Simple presets** and only for loops that are part of the current
preset (DOCUMENTED; FORUM-STAFF: "it needs to be used in the preset in order to bypass and engage").
PC 0–127 recalls a preset of the **current** bank; CC#0 0–3 selects Banks 1–4 first (DOCUMENTED;
owner-verified for bank select + PC recall over USB and over MC8 DIN, see `S4-H03`).

| CC# | Function | Values | Status |
|---|---|---|---|
| 0 | Change bank | 0–3 = Banks 1–4 | DOCUMENTED, **HW-PASS** (S4-H03) |
| 4 | Engage/bypass all loops in the current preset | 0–63 bypass, 64–127 engage | DOCUMENTED |
| 5 / 6 | Scroll preset up / down | any | DOCUMENTED |
| 7 / 8 / 9 | Mute / Unmute / Toggle mute | any | DOCUMENTED |
| 10–19 | Engage/bypass loop A Tip, A Ring, B Tip … E Ring | 0–63 bypass, 64–127 engage | DOCUMENTED (10), openmidi (11–19) |
| 20–29 | Toggle loop A Tip … E Ring | any | DOCUMENTED (20), openmidi (21–29) |
| **30–39** | **Output cut** A Tip, A Ring, B Tip … E Ring (v1.2) | **64 = toggle, 0 = restore, 127 = cut** | DOCUMENTED (v1.2 release notes; matches openmidi). The staff forum post that read the reverse way is treated as superseded. Purpose per staff: break a merge without bypassing a node. |
| **40–43** | Input Tip, Input Ring, Output Tip, Output Ring bypass/engage (v1.2) | 64 = toggle; other values' meaning not stated | DOCUMENTED (release notes), semantics PARTIAL |
| **50** | Loop Bypass Persist on/off (v1.2) | >63 on, ≤63 off | FORUM-STAFF |
| **51** | Reload the current preset's loop bypass states (v1.2, 2025-11-24) | any | DOCUMENTED |
| **52** | Save the current loop bypass status to the preset (v1.2); rate-limited to once per 5 s | any | DOCUMENTED |

**Loop Bypass Persist** (global, DOCUMENTED, help article updated 2026-03-03, still labelled beta):
ON keeps each loop's engage/bypass state across preset changes; a preset then only re-orders the
chain. OFF loads each preset's saved default states. Morningstar's own description of a preset load is
two steps: set up the signal chain, then set each loop's state — "this step is IGNORED if Loop Bypass
Persist = ON". Known bug history: with Persist on, boot ignored saved states (fixed 2025-11-24);
after a backup → factory reset → restore on 1.2 beta, a user saw every loop stay active regardless of
preset and staff's answer was to switch Persist off (FORUM). **Consequence for Signal Loom:** the
compiler's "absolute state" assumption (bank + PC = known loop states) is **only true with Persist
off**; the setting must be part of the instance's declared configuration and of any owner checklist.

**Saving bypass states from the device:** Menu + Select (2026-06-30 build) or CC#52 writes the live
loop states into the current preset — these are **memory writes triggered by MIDI**, so Signal Loom
must never emit CC#52 (or CC#50) from a Scene without the hardware-risk gate.

**MC-series "ML10X" message type** (what an MC8 sends to drive an ML10X): SysEx-based, needs the
ML10X's **Device ID** (Omni broadcasts to all IDs), engages selected loops / bypasses the rest, toggles
selected loops (Simple only), scrolls and recalls presets. Some pedals in the chain do not pass SysEx
(HX Stomp, Microcosm named). The byte format is **not public**; the editor exposes a "SysEx
Creation Utility" (Editor v1.1.6+) for MC presets. Signal Loom continues to compile PC/CC only.
(DOCUMENTED existence; UNVERIFIED bytes.)

---

## 4. The editor backup file (`Device Backup`)

### 4.1 Shape (one real file, 902,208 bytes, 512 presets)

```
schemaVersion: 1
dumpType: "full"
deviceModel: 7
downloadDate: ISO-8601
hash: int32
data:
  presetData[4]: { bank: 0..3, data[128]: preset }
  controllerData: { midiChannel, deviceId, inputRingSwapPin, inputSplit,
                    loopBypassPersistent, connectors[14] }
preset: { presetNumber, presetName, tipT, ringT, matrixArray{"0".."15": [b0,b1,b2]},
          advancedMode, bypass }
connector: { id 0..13, pos, name, shortName, trails, inputName, outputName }
```

Status: THIRD-PARTY-CAPTURE (the file) + Signal Loom's reader (`ml10x_native.py`,
`test_real_ml10x_backup_hash_and_shape` passes on it locally: hash matches, byte-exact, zero unknown
keys). Observed file name convention from one forum user:
`Morningstar_ML10X_Backup_File_YYYYMMDD_HHMMSS.json` (FORUM-USER, one sample). The editor's generic
manual calls the tab *Controller Backup*; the ML10X manual only says "In the Editor, you can backup
and restore your device" (DOCUMENTED).

Model enum behind `deviceModel` (THIRD-PARTY-SOURCE): `MC6MK2=3, MC8=4, MC3=5, MC6PRO=6, ML10X=7,
MC8PRO=8, MC4PRO=9, ML5R=10, MC6PROMK2=11`.

### 4.2 What each preset field is (editor class `Kb`, THIRD-PARTY-SOURCE)

| JSON key | Editor field | Meaning | Status |
|---|---|---|---|
| `presetName` | `presetName` | ≤16 chars in the editor schema; **12 bytes on the wire** (READ pads to 12, WRITE trims; third-party encoder truncates to 12). What the editor does with a 13–16 char name is unknown. | PARTIAL |
| `tipT`, `ringT` | `tipTrails`, `ringTrails` | Spillover target for Output Tip / Output Ring, as the editor's `j2` dropdown code: `127` Nothing, `2` Input Tip, `3` Input Ring, `1` A Tip, `0` A Ring, `15` B Tip, `4` B Ring, `11` C Tip, `6` C Ring, `13` D Tip, `12` D Ring, `9` E Tip, `10` E Ring. The table is confirmed for the **wire write form**; that the JSON carries the same code is an inference (the JSON field mirrors the editor field) — only `127` has been seen in a file. "Last connected" (`0x7E` suspected) is MC-series only per the third party, yet the 2026-03-27 firmware note fixes "last connected as trails" on the ML10X. | THIRD-PARTY-SOURCE; JSON mapping UNVERIFIED |
| `advancedMode` | `isAdvancedMode` | Simple (false) / Advanced (true). | THIRD-PARTY-SOURCE, consistent with device READ (`P5>0` = Advanced) |
| `bypass` | `bypassLoopStatus` | A 24-bit integer sent on the wire as three 7-bit bytes (`b0 = v & 0x7F, b1 = v>>7, b2 = v>>14`), described as the per-loop bypass bitmap. **0 in every one of the 512 presets** even though three presets carry a hop with the record flag set (§5.2). Either outputs are excluded from this bitmap, or it is only written by the v1.2 Advanced-mode bypass feature, or the capture's editor build never populated it. | THIRD-PARTY-SOURCE; layout UNVERIFIED |
| `matrixArray` | `matrixArray` | 16 rows × 3 bytes = wire segments 48..63 byte for byte (§5). | THIRD-PARTY-CAPTURE, LOCAL-ANALYSIS |
| *(absent)* | `connectionArray` | The explicit `[from, to, flag]` records the device sends. **Not exported.** | THIRD-PARTY-SOURCE |
| *(absent)* | `mutedSwitchOption` (0..2), `hasLoadedOnce` | Advanced-only wire segment 18 carries the muted-switch option; neither is in the JSON. | THIRD-PARTY-SOURCE |

Controller fields: `midiChannel` 0..16 (0 = ignore), `deviceId` 0..16, `inputSplit`,
`loopBypassPersistent` (booleans; on the wire 127/0), `inputRingSwapPin` (present, always 0, no
editor control on v1.2), `connectors[].trails` = the per-loop "Enable Spillover" toggle (wire: a
14-bit bitmap, bits 10–13 unused).

### 4.3 Integrity hash

`hash` = Java `String.hashCode` over the compact JSON of `data` (Session 7; re-reproduced today:
424497435). Evidence is still **one real ML10X file**, but the MC8 algorithm matching exactly makes a
different ML10X algorithm unlikely. New supporting evidence: a forum user who hand-edited an ML10X
backup to move presets between banks reported "there is some sort of integrity hash/checksum on the
file and … a modified file won't load onto the device" (FORUM-USER) — i.e. **the editor does validate
the hash on restore**, and a correctly re-hashed file is a prerequisite for any Signal Loom-written
ML10X file. Staff in the same (older) thread: moving presets between banks has "no easy way … the only
way would be to edit the json file and then upload it" (FORUM-STAFF); the editor has since gained
copy/paste (2025-01-10) and a fix for copying in banks 2–4 (2026-10-01), so single-preset moves are
possible in the editor today, one preset at a time.

### 4.4 Restore semantics — what is and is not known

- Generic editor manual (DOCUMENTED, written for MC controllers): *Controller Backup → Choose File*;
  a **Bank Backup** replaces the current bank; an **All Banks Backup** overwrites the entire
  controller **and its global settings**. Whether the ML10X editor offers a bank-level file at all is
  unknown; the one real file is `dumpType: "full"`.
- **How the editor pushes a restored preset to the device is not captured.** Two possibilities,
  both consistent with the evidence: (a) the editor decodes `matrixArray` into `connectionArray` and
  sends ordinary preset writes (then the editor bundle contains the decoder — the single most
  valuable thing to recover); (b) the editor uploads the raw backup through the `DataDump` (`f1=7`) /
  `DataUploadAck` (`f1=8`) message classes that exist in the inbound classifier, carrying segments
  48..63 as they are (then the device itself consumes the matrix). Resolving this is owner test **T2**
  (§8). Until then, Signal Loom must treat a backup's `matrixArray` as opaque bytes that **must travel
  intact** with its preset.
- Restore anomalies on record (FORUM-USER, 1.2 beta): after restore all loops stayed engaged
  regardless of preset (Persist had switched on); a second user saw every Tip/Ring bypassed after
  reloading a backup. Both are reasons to put "check Loop Bypass Persist, then recall a known preset
  and look at the LEDs" into any restore checklist.

### 4.5 Consequence: which backup edits are safe today

| Edit | Needs the matrix decoded? | Signal Loom status |
|---|---|---|
| Rename presets, connectors; change MIDI channel / Device ID / Input Split / Persist / trails | No | Feasible by extending the MC8-style proposal layer to ML10X files, hash recomputed; **not built, editor-unvalidated** |
| Change spillover (`tipT`/`ringT`) | No, but the code table is unverified in JSON | Possible once a non-127 sample confirms the code (test T3) |
| **Move / copy / swap whole presets** across slots and banks (renumber `presetNumber`, keep everything else) | No | Feasible in the same slice; the only unknown is a device-side meaning of `matrixArray` rows 12–15 (§5.3) or of `bypass` that depends on the slot — both are carried verbatim, so nothing new is invented |
| Change the chain, add/remove loops, change bypass | **Yes** | **Blocked** (`F-Q14`) |

---

## 5. How the device represents routing

### 5.1 Three representations of one preset

| Where | Form | Who reads/writes it |
|---|---|---|
| Device → editor (**READ**, `f1=6 f2=0`, 219 bytes) | 12 fixed slots (segments 0..11) of `[from, to, flag]` + spillover (2 bytes each, `[is_set, code]`) + segment 18 (1 byte) + segment 20 (1 byte) + name (12 bytes) + **matrix segments 48..63** (3 bytes each). `P3` = preset, `P4` = bank, `P5 > 0` = Advanced. | Device writes; editor and third-party CLI read |
| Editor → device (**WRITE Simple**, `f1=6 f2=0 P3=127`) | One segment per "from-able" connector, **segment id = the source's groupNumber**: `[from, to, bypass]` when linked, `[gn, 0x7F]` when not. Two connectors are never emitted (Input Ring gn 1 and Output Tip gn 2) and the device rejects messages that include them. **Order-sensitive:** unrouted first in a fixed order (`4 9 5 10 6 11 7 12 8 13 3 0`), then routed in chain order. Then spillover (1 byte each), segment 20 = 0, name (trimmed, ≤12). Caveat: the captured rig had **Input Split on**, so Input Ring was never a source; what the editor emits when Input Ring is routed is unknown. | Editor writes; third-party encoder reproduces it byte for byte |
| Editor → device (**WRITE Advanced**, `f1=6 f2=2 P3=127`) | One 1-byte segment per edge, **segment id = target groupNumber, data = source groupNumber**; spillover; segment 18 = muted-switch option; segment 19 = `bypassLoopStatus` as 3 bytes (always `00 00 00` in the captures); name. | Same |
| Backup JSON | `matrixArray` only (+ `bypass`, `tipT`, `ringT`, `advancedMode`, name) | Editor writes; Signal Loom reads |

A never-used slot (bank 3, preset 127) reads back with **no** records and an all-zero matrix
(THIRD-PARTY-CAPTURE).

### 5.2 The record and its flag

Editor source (THIRD-PARTY-SOURCE): `addData(x.groupNumber, 3, [x.groupNumber, B.groupNumber,
B.isActive ? 0 : 1])` — the record belongs to the **source** `x`, and the third byte is **the state of
the target** `B`: `0` active, `1` bypassed. Hardware probe (THIRD-PARTY-CAPTURE): clicking the A Tip
node in the editor flipped exactly one byte, the third byte of the record *into* A Tip (`A Ring → A
Tip`: `09 04 00` → `09 04 01`).

LOCAL-ANALYSIS of all captured presets:

| Preset | Records (READ form) |
|---|---|
| Base (0/0) | Input Tip → Output Tip **/1** |
| Clean (0/1) | Input Tip → A Tip /0; A Tip → A Ring /0; A Ring → D Tip /0; D Tip → Output Tip **/1** |
| Empty #2 (0/2) | Input Tip → A Ring /0; A Ring → A Tip /0; A Tip → Output Tip **/1** |

Every hop **into Output Tip** carries flag `1` while the JSON `bypass` of those presets is `0`. So the
flag on an output hop does not mean "signal cut" (these are the user's working presets), most likely
the output's `isActive` default. **Treat the flag as "target loop bypassed" only for loop targets;
for output targets its meaning is UNVERIFIED** (owner test T3 pins it: save a preset with one loop
bypassed, export, compare `bypass` and the flags).

A second observation from the bypass probe (LOCAL-ANALYSIS, not in the third party's notes): after
each UI toggle the editor sent a *second* preset message with `P3=0 P4=0` carrying the toggled flag,
**without** an acknowledgement, and only the explicit *Save* used `P3=127` and was acknowledged
(`f1=1 f2=2`, "Preset Settings Saved!"). This matches the help article's "in Simple mode changes are
immediately reflected … in Advanced mode you need to SAVE first": `P3=0` looks like a **live apply
without saving** and `P3=127` like **save to the current preset**. Hypothesis — it would give Signal
Loom a non-persistent way to audition a chain, but it must not be relied on before an owner capture
confirms it and confirms that `P3=0` does not write memory. The alternative reading — an explicit
write to bank 0 preset 0 — would have overwritten preset 0 ("Base") with preset 2's chain; "Base" is
intact in the backup exported the same day and in every later capture, which argues against it
without settling the order of events.

### 5.3 Matrix rows — now device-labelled

In every READ message the 12 record slots appear in the same order and each record's first byte
*echoes its source connector*: slot 0 Input Tip, 1 Input Ring, 2 A Tip, 3 A Ring, 4 B Tip, 5 B Ring,
6 C Tip, 7 C Ring, 8 D Tip, 9 D Ring, 10 E Tip, 11 E Ring (12/12 in all captures). The non-zero
matrix rows are always exactly the slots whose record has a target (Base: row 0; Clean: rows 0, 2, 3,
8; Empty #2: rows 0, 2, 3). Session 7's "row hypothesis" is therefore **confirmed by the device's own
slot numbering** (THIRD-PARTY-CAPTURE + LOCAL-ANALYSIS; still not owner-observed). The
inspector's label can move from *hypothesis* to *third-party capture, 12/12*.

Rows 12–15: never a chain source. Row 15 = `[1,0,0]` appeared on preset *Empty #2* only in captures
made **after** that preset had been saved in Advanced mode and back to Simple, and the later-exported
JSON has it too. Candidate meaning: a "was Advanced / loaded once" flag. UNVERIFIED.

### 5.4 Matrix columns — still a per-source lookup

Reading each row as a 21-bit field (`bit = byte*7 + bit`), one bit per routed source:

| Source → target | Bit | Seen in |
|---|---|---|
| Input Tip → Output Tip | 2 | Base |
| Input Tip → A Ring | 1 | Empty #2 |
| Input Tip → A Tip | 13 | Clean |
| A Tip → Output Tip | 0 | Empty #2 |
| A Tip → A Ring | 2 | Clean |
| A Ring → A Tip | 2 | Empty #2 |
| A Ring → D Tip | 1 | Clean |
| D Tip → Output Tip | 0 | Clean |

Output Tip is bit 2 from Input Tip but bit 0 from a loop return; A Tip is bit 13 from Input Tip but
bit 2 from A Ring. The bit is **not** a function of the target, so this is not a plain crosspoint
image; it reads like a per-source multiplexer select (an input-to-send path and a return-to-send path
are different hardware). Eight of roughly 12 × 13 cells are known, all consistent with a fixed table
keyed by (source, target); the bypass flag did not change the matrix in any capture (the probe did
not re-read after toggling, so this is weak). **Status unchanged: undecoded, no writer.** The hardware
part number was not found (no teardown or FCC photo surfaced).

### 5.5 The decoder path that does not need the editor

A wire dump of the owner's device (navigate to each of 512 slots, read the `f1=6 f2=0` reply; the
third-party CLI does this in ~2 minutes) returns, per preset, **both** the records and the matrix.
Every used preset adds its (source, target) cells; a rig with a dozen presets over all ten loops
would likely cover most of the table. This is read-only in the memory sense, but **it changes the
active preset** (audible routing changes, LEDs), so it is a hardware-risk-gated owner session with
the amp muted, and it must end by re-selecting the preset that was active. Once a full table exists,
`matrixArray` can be **generated** from a chain, and native ML10X backup export unblocks with no
reliance on undocumented editor behaviour.

### 5.6 Two numberings of the same 14 connectors (THIRD-PARTY-SOURCE)

| Connector | `value` (JSON `connectors[].id`, controller-data segment ids, read slots) | `groupNumber` (preset records, write segment ids) |
|---|---|---|
| A Tip, A Ring | 0, 1 | 4, 9 |
| B Tip, B Ring | 2, 3 | 5, 10 |
| C Tip, C Ring | 4, 5 | 6, 11 |
| D Tip, D Ring | 6, 7 | 7, 12 |
| E Tip, E Ring | 8, 9 | 8, 13 |
| Input Tip, Input Ring | 10, 11 | 0, 1 |
| Output Tip, Output Ring | 12, 13 | 2, 3 |

Signal Loom's `CONNECTOR_LABELS` (ids 0–13) is the `value` numbering and is correct for the backup
file; any wire-level work needs the `groupNumber` table too. Sources on the wire are the 12
non-output connectors; targets are the 12 non-input connectors.

---

## 6. The USB SysEx protocol (what "writing to the pedal" would use)

All THIRD-PARTY-SOURCE unless marked CAPTURE. Morningstar publishes a SysEx description for the MC
series (frame, manufacturer ID, checksum); the ML10X framing is the same family but the ML10X-specific
codes below are reverse-engineered, so the whole section is **third-party evidence, not
manufacturer-documented**, and nothing here is implemented in Signal Loom.

**Frame.** `F0 00 21 24 07 00 P1 P2 P3 P4 P5 P6 P7 P8 L1 L2 <segments…> CS F7`. `07` = ML10X.
Outbound `L1 L2 = 00 00`; **inbound** carries the total length: `L1 = (len>>7) & 0x3F | flag<<6`,
`L2 = len & 0x7F` (editor rejects a mismatch and sends a `P2=126` retry request). Checksum = XOR of
every byte from `F0` up to but excluding the checksum slot, masked `& 0x7F`. Segment = `7F <id> <len>
<len bytes>`, every byte masked to 7 bits.

**Connect.** Send four empty frames `P1=0, P2 = 0, 24, 19, 21` (~12 ms apart). The device streams,
unprompted and **twice each**: `f1=1 f2=0` connected; `f1=17` UUID; `f1=6 f2=1` controller data
(935 bytes); `f1=6 f2=0` the active preset; `f1=6 f2=2` all 128 names of the current bank (1938
bytes); plus `f1=1 f2=5/6/7` loading lifecycle with up to 256 progress messages. The **first** copy of
the preset can be a stale stub; the second is authoritative, or re-read with an explicit navigate.
The three `REQUEST_*` opcodes tried (43, 44, 64) produced no reply on v1.2, and the third party
believes none of them do (CAPTURE).

**Navigate.** `P2=22 P3=bank` (also resets to preset 0 of that bank and triggers a fresh stream, up
to ~6 s), then `P2=18 P3=preset`. No acknowledgement; the device replies with the preset's data.
**Hazard:** `P2=32` looked like navigation but is **"Paste Preset to all banks"**, a destructive
operation the third party fired by mistake. Any Signal Loom implementation must allow-list opcodes.

**Write a preset.** Navigate, wait for the stream to go idle (seconds, not 200 ms), then send the
Simple (`f2=0`) or Advanced (`f2=2`) write with `P3=127` = "save to the currently selected preset"
(the only form known to be accepted). Expect `f1=1 f2=2` within ~35 ms; the device does **not** echo
the saved preset, so verification means navigating again and reading. Writing an explicit `P3=n` is
untested.

**Write controller settings.** `f1=6 f2=1` with all four name tables (ids 0–13 long, 48–61 short,
64–77 input labels, 80–93 output labels; 7-bit ASCII), 32 MIDI channel, 33 trails bitmap (2 × 7-bit,
high byte first), 34 Device ID, 35 Input Split (127/0), 36 Persist (127/0). No dedicated ack on v1.2.

**Timing from the working CLI:** after connect, drain until 1.5 s idle (max 6 s); after a bank change
1.2 s idle (max 6 s); preset-select retry up to 2× on timeout; a sequential full dump missed the first
~3 presets of each bank until a ≥6 s post-bank-change wait was added.

**Safety summary for a future Signal Loom "ML10X live" scope:** (1) the device must be externally
powered (USB alone does not switch relays); (2) every navigate changes the live audio path; (3)
`P3=127` writes *whatever* is current — read back and compare the slot before writing; (4) no opcode
outside the allow-list `{0, 24, 19, 21, 22, 18}` plus the two write forms; (5) take a Device Backup
in the official editor first; (6) the official editor must be closed (one owner per port); (7)
Loop Bypass Persist state recorded before and after.

---

## 7. Contradictions and open questions (status versus `raw-ml10x.md`)

| # | Question | 2026-10-15 | Now |
|---|---|---|---|
| 1 | Do CC 10–29 act on Advanced presets on v1.2? | Unverified | Still unverified; forum reports both "same CC implementation as Simple" (staff, 2024 beta thread) and "advanced mode no longer responding to loop bypass messages" (user thread, 2026). Keep `advanced_mode_cc_bypass = False`. |
| 2 | v1.2 still beta? | Yes | Yes, but actively maintained through 2026-10-01 and the only line with the owner-relevant features. |
| 3 | CC 30–39 polarity | Contradicted | **Resolved:** 0 restore, 127 cut, 64 toggle (release notes = openmidi). |
| 4 | Default MIDI channel / Device ID | Unknown | Still unknown. |
| 5 | Preset name 16 vs 12 | Open | Editor 16, wire 12 (READ padded, WRITE trimmed). Effective device limit 12 is the safe assumption; editor behaviour for 13–16 unknown. |
| 6 | openmidi "MIDI OUT" row | Data error | Unchanged. |
| 7 | `matrixArray` semantics | Undecoded | Rows device-labelled (§5.3); columns undecoded (§5.4); decoder path identified (§5.5). |
| 8 | How restore reaches the device | — | Unknown (§4.4); owner test T2. |
| 9 | Meaning of flag=1 on output hops; `bypass` always 0 | — | New; owner test T3. |
| 10 | `P3=0` live-apply message | — | New hypothesis (§5.2); owner test T4. |
| 11 | Row 15 after an Advanced round trip | — | New observation; no test proposed. |

---

## 8. Owner test package (offline-first, ordered by risk)

Each test follows the hardware acceptance package of the operating model §6; the baseline for all:
record firmware build (device menu or the `.hex` name used), rev-A/B, editor URL (release or beta),
Loop Bypass Persist state, and keep an untouched Device Backup before anything else.

**T1 — Controlled export pairs (`S7-E03`, unchanged, no device write).** In the editor, export a
Device Backup; in *one* preset change exactly one loop; export again; load both in *Routing
experiment*. Each pair adds one (source, target) cell to §5.4. Repeat for as many distinct
(source → target) hops as convenient.

**T2 — What does Restore send? (editor only, writes to the device).** Prerequisites: a spare bank or
a throwaway preset, a MIDI monitor that shows SysEx on the ML10X USB port (MIDI-OX on Windows, or a
Web MIDI capture). Steps: (1) export Backup A; (2) in the editor rename one preset, save; (3) export
Backup B; (4) start the monitor; (5) *Controller Backup → Restore* with Backup A; (6) stop the
monitor and save the log; (7) confirm the preset name reverted on the device. Record: the `f1`/`f2`
codes and lengths of what the editor sent (one message per preset? 512 messages? segments 48–63
present?). Pass/fail is informational; the outcome decides §4.4 (a) vs (b). What it does not prove:
anything about Signal Loom-written files.

**T3 — Pin `bypass`, output-hop flags and spillover codes (editor only).** Create a Simple preset in
an unused slot with loops A Tip and B Tip, bypass A Tip, set Output Tip spillover to A Tip, save,
export. Expected in the file: `bypass ≠ 0` and `tipT = 1` if the inferences in §4.2 hold. Then export
the same preset with spillover "Nothing" and A Tip engaged to get the zero baseline. Keeps all
existing presets untouched.

**T4 — Live-apply versus save (device, no intended memory write).** With the monitor running, toggle
one loop in a Simple preset in the editor **without** saving, then select another preset and come
back: if the toggle did not persist and the monitor shows a `P3=0` message without an ack, §5.2's
hypothesis holds. Restore the toggle before leaving.

**T5 — Full wire dump for the decoder (device, read-only memory, audible).** Only after T2–T4 and a
separate scope approval: amp muted, editor closed, run a dump that navigates every slot and records
each reply; end by re-selecting the original bank/preset and confirming the display. Deliverable: a
local JSON of (records, matrix) per preset, from which §5.4's table is completed. Never commit the
dump (it is the owner's rig).

---

## 9. Recommendations for Signal Loom (Team B scope, ordered)

1. **Now, documentation-level (this PR):** record the findings; keep `F-Q14` blocked; add `S8-E01…E04`
   for T2–T5.
2. **Next independent software slice (no hardware):** in the Morningstar Bridge, (a) relabel the
   matrix rows per §5.3 and state the column status per §5.4; (b) extend the ML10X *proposal* layer
   to the routing-free edits of §4.5 — names, controller settings, and **move/copy/swap presets across
   slots and banks** with `matrixArray`, `bypass`, `tipT`, `ringT`, `advancedMode` carried verbatim and
   the hash recomputed; refuse any edit that would touch `matrixArray`. Same gates as the MC8 proposal
   (hash present and matching, `schemaVersion` 1, byte-identical no-edit round trip). This directly
   serves `UX-ML10X-01`'s "move a preset" need through the editor's own restore path, and the editor
   remains the thing that writes to hardware. Editor-validation is an owner test in a spare bank.
3. **After T2:** if restore turns out to decode the matrix in the editor, prioritise recovering that
   decoder (reading the editor bundle is legal reverse-engineering for interoperability but
   must be done by the owner on their own machine, not in this sandbox); if restore uploads raw
   segments, the backup-file route is complete for all routing-free edits and T5 becomes the only path
   to routing authorship.
4. **Only with a separately approved hardware-risk scope:** a guarded ML10X live reader (connect,
   navigate, read, never write) using the allow-list of §6, producing the (records, matrix) pairs.
   Writing presets over SysEx stays out of scope until the reader is owner-validated and a backup /
   compare / restore story exists.
5. **Compiler/instance model (Team A coordination):** add `loop_bypass_persistent` and
   `firmware_build` as declared instance facts; when Persist is on, downgrade the "absolute loop
   state" claim of an ML10X preset recall to a warning. Keep `ML10X_DEFAULT_MIDI_CHANNEL = None`.

---

## 10. Sources

Official and vendor-hosted
- https://github.com/Morningstar-Engineering/ML10X/releases (v1.2.0 BETA notes, assets, dates; v1.1.2; v1.1.1) — fetched 2026-10-23.
- https://github.com/Morningstar-Engineering/ML10X (README: firmware upload procedure shared with MC3/MC6/MC8).
- https://help.morningstar.io/en/article/ml10x-user-manual-262ann/ and https://manuals.morningstar.io/ml10x/user-manual (excerpts only).
- https://help.morningstar.io/en/article/using-advanced-mode-in-the-editor-h936bv/ ; https://help.morningstar.io/en/article/engagebypass-loops-in-advanced-mode-1yfscic/ ; https://help.morningstar.io/en/article/loop-bypass-persist-maintaining-bypass-state-across-presets-on-ml10x-ochgy1/ ; https://help.morningstar.io/en/article/message-types-1du3iiv/ ; https://help.morningstar.io/en/article/morningstar-editor-user-manual-81kpjn/ (excerpts only).
- https://manuals.morningstar.io/mc-midi-controller/sysex-documentation-for-external-applications (MC-series SysEx; excerpt only).

Forum (excerpts only)
- https://forum.morningstar.io/t/ml10x-v1-2-beta-firmware/4869 ; https://forum.morningstar.io/t/beta-engage-bypass-loops-in-advanced-mode/8493 ; https://forum.morningstar.io/t/loop-bypass-persist-overrides-presets-at-startup/11838 ; https://forum.morningstar.io/t/advanced-mode-no-longer-responding-to-loop-bypass-messages/11670 ; https://forum.morningstar.io/t/move-preset-to-different-bank/5314 ; https://forum.morningstar.io/t/how-to-save-ml10x-presets-on-the-unit/12666 ; https://forum.morningstar.io/t/issues-using-ml10x-sysex-messages-with-quad-cortex-mini/12356 ; https://forum.morningstar.io/t/mc6-pro-messages-to-control-ml10x/6868 ; https://forum.morningstar.io/t/resolved-bug-in-last-connected-for-select-output-spillover/4766 ; https://forum.morningstar.io/t/firmware-1-2-0-volume-drop/11737 ; https://forum.morningstar.io/t/ml10x-not-responding-to-midi/7466.

Third party
- https://github.com/ragb/ml10x-access-rs (GPL-3.0; commit `c212f4b`, 2026-05-28): `docs/sysex.md`, `docs/reverse-engineering-notes.md`, `docs/handshake-quirks.md`, `crates/ml10x-core/src/{device,sysex,encode,decode,presets}.rs`, fixtures `editor-device-backup.json`, `real-device-connect-bank0.json`, `real-device-save-preset-0.json`, `real-device-bypass-toggle-probe.json`, `real-device-advanced-mode-probe.json`, `real-device-clean-advanced-probe.json`. Cloned read-only for analysis; nothing vendored.
- Signal Loom: `docs/morningstar-bridge.md` §2, `docs/research.md` §4, `docs/research/raw-ml10x.md`, `backend/app/morningstar/ml10x_native.py`.
