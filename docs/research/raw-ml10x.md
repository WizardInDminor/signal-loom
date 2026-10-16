# Raw reconnaissance notes: Morningstar ML10X

Collected 2026-10-15 by a research agent. **Network caveat:** every Morningstar host was
unreachable; evidence is (1) search-engine excerpts of official pages — "DOCUMENTED (excerpt)",
(2) git clones readable anonymously: the official `Morningstar-Engineering/ML10X` repo (README
+ tags only), the Morningstar-hosted `Morningstar-Engineering/openmidi` community database —
"OFFICIAL-REPO", and third-party repos (`ragb/ml10x-access-rs`, GPL-3.0, containing a real editor
backup fixture and reverse-engineered SysEx notes) — "THIRD-PARTY".

## 1. Physical
- "10 loops across 5 TRS send/return pairs"; 5 stereo loops each splittable into 2 mono loops. https://manuals.morningstar.io/ml10x/user-manual , https://www.morningstar.io/ml10x — DOCUMENTED (excerpt).
- I/O: 1 x stereo TRS Input, 5 x stereo TRS Send, 5 x stereo TRS Return, 1 x stereo TRS Output — DOCUMENTED (excerpt).
- Connector model: 14 connectors = loop endpoints A Tip, A Ring, B Tip, B Ring, C Tip, C Ring, D Tip, D Ring, E Tip, E Ring + Input Tip, Input Ring, Output Tip, Output Ring; each tip/ring programmable independently; ports renameable — DOCUMENTED (excerpt); confirmed by the real backup fixture (`controllerData.connectors`, 14 entries) — THIRD-PARTY.
- No "stereo mode": a stereo pedal uses Tip = L, Ring = R of one loop via a TRS-to-dual-TS splitter (Morningstar Splitter Cable; black = Tip, red = Ring). FAQ: "SEND TIP → device INPUT, device OUTPUT → RETURN TIP" — DOCUMENTED (excerpt).
- Main in/out are stereo TRS; splitter cable needed for stereo use — DOCUMENTED (excerpt).
- "Input Split" global setting (firmware 2024-11-22 / rev-b): Input Tip copied to Tip and Ring — DOCUMENTED (excerpt).
- All loops/inputs/outputs buffered — DOCUMENTED (excerpt).
- MIDI: 1 x 5-pin MIDI In, 1 x 5-pin MIDI Thru. No MIDI Out, no TRS MIDI. USB-C (editor/firmware/backups; USB alone does not power switching). No expression/aux jacks listed — DOCUMENTED (excerpt / absence).
- Power 9–18 VDC centre negative, min 160 mA; PSU not included — DOCUMENTED (excerpt).
- Dimensions 169 x 58 x 58 mm; weight 439 g (shop) / 0.45 kg (site) — DOCUMENTED (excerpt).
- Rev B (Sept 2023+) needs `rev-b` firmware — THIRD-PARTY (forum, staff reply).

## 2. Presets, Simple vs Advanced, firmware v1.2
- **4 banks x 128 presets (0–127) = 512** — DOCUMENTED (excerpt) + fixture.
- Each preset is Simple or Advanced (editor "Mode" button) — DOCUMENTED (excerpt).
- Editor-native preset JSON (real backup, THIRD-PARTY): `presetNumber`, `presetName`, `tipT`, `ringT` (spillover targets, 127 = Nothing), `matrixArray` (keys "0".."15", 3 ints each — semantics UNDECODED), `advancedMode` (bool), `bypass` (int bitmap).
- No per-preset MIDI message list on the ML10X — THIRD-PARTY.
- **Simple mode:** mono series chain Input → chosen loops in order → Output; per-loop bypass state saved with the preset; per-loop CC engage/bypass/toggle works ONLY in Simple presets; spillover: one loop per output — DOCUMENTED (excerpt).
- No MIDI API to re-order loops; one preset per order — THIRD-PARTY (forum ~2023).
- **Advanced mode:** split and merge, series and parallel; editor only (device can only reset to simple); no mixer/level control; merging to the same output connector averages, separate connectors sum (paraphrase, re-read before relying); pre-v1.2 manual: "Loops cannot be bypassed in advanced mode"; bypassing a node in a split/merge layout can create a feedback path — DOCUMENTED (excerpt).
- **Firmware v1.2 Advanced Mode change** (https://help.morningstar.io/en/article/using-advanced-mode-in-the-editor-h936bv/): "The ML10X v1.2 update enhanced Advanced Mode to allow the engage/bypass of loops." "Each loop will now show a Green or Red shade to indicate if it is Engaged (Green) or Bypassed (Red) when the Preset is loaded." "To toggle, you'll need to DOUBLE-CLICK on the node." "Unlike Simple Mode, the changes are not immediately reflected … You'll need to SAVE the preset first." — DOCUMENTED (excerpt).
- Other v1.2 features: Loop Bypass Persist; Input Ring split; renaming ports; CC#30–39 output cut; CC#40–43 in/out tip/ring bypass; CC#50 persist; CC#51 reload; CC#52 save bypass status — https://github.com/Morningstar-Engineering/ML10X/releases — DOCUMENTED (excerpt).
- **Firmware status:** v1.1.2 tagged Latest (stable); v1.2.0 BETA pre-release ("Use the Beta Editor"); help centre (2025): use v1.1.2 for Simple-mode use, beta v1.2 for Advanced-mode bypass. Treat v1.2 as beta.

## 3. MIDI implementation
- PC 0–127 recalls presets 0–127 of the **current bank**; CC#0 value 0–3 selects Banks 1–4 first — DOCUMENTED (excerpt) + openmidi OFFICIAL-REPO.
- MIDI channel set on device (Menu > Global Settings > Edit MIDI Channel) or editor; 0 = ignore MIDI. **Factory default channel: UNVERIFIED.**
- Per-loop CC works only in Simple presets and only for loops that are part of the current preset — DOCUMENTED (excerpt).

| CC# | Function | Values | Evidence |
|---|---|---|---|
| 0 | Change Bank | 0–3 = Banks 1–4 | DOCUMENTED (excerpt) |
| 4 | Engage/Bypass all loops in current preset (Simple) | 0–63 Bypass, 64–127 Engage | DOCUMENTED (excerpt) |
| 5 / 6 | Scroll preset Up / Down | any | DOCUMENTED (excerpt) |
| 7 / 8 / 9 | Mute / Unmute / Toggle Mute | any | DOCUMENTED (excerpt) |
| 10–19 | Engage/Bypass Loop A Tip, A Ring, B Tip, B Ring, C Tip, C Ring, D Tip, D Ring, E Tip, E Ring (Simple only) | 0–63 Bypass, 64–127 Engage | CC10 DOCUMENTED (excerpt); 11–19 openmidi OFFICIAL-REPO |
| 20–29 | Toggle Loop A Tip … E Ring (Simple only) | any | CC20 DOCUMENTED (excerpt); rest openmidi |
| 30–39 | Output Cut A Tip … E Ring (v1.2) | polarity CONTRADICTED (0 restore/127 cut per openmidi vs reverse per staff forum post) | UNVERIFIED |
| 40–43 | Input Tip/Ring, Output Tip/Ring bypass/engage (v1.2) | 64 = toggle (release notes) | UNVERIFIED semantics |
| 50 / 51 / 52 | Loop Bypass Persist / Reload loop states / Save bypass status (v1.2) | | DOCUMENTED (excerpt) |

- SysEx "ML10X message type" (MC-series controllers): manufacturer ID 00 21 24, model byte 0x07, Device ID 0..16 must match — THIRD-PARTY reverse engineering; existence of the message type DOCUMENTED (excerpt).

## 4. Editor and backup format
- Editor: https://editor.morningstar.io (release firmware), https://editor-beta.morningstar.io (beta), manual cites https://editor-mkii.morningstar.io/ml10x — DOCUMENTED (excerpt).
- Backup: manual says only "In the Editor, you can backup and restore your device." Generic editor manual: Controller Backup tab. **No official ML10X schema, extension or hash documentation.**
- Real backup (THIRD-PARTY, GPL-3.0 repo `ragb/ml10x-access-rs`, fixture `crates/ml10x-core/tests/fixtures/editor-device-backup.json`, rev-B unit, v1.2, May 2026; NOT vendored here because of licensing): top level `schemaVersion` 1, `dumpType` "full", `deviceModel` 7, `downloadDate`, `hash` (algorithm UNVERIFIED for ML10X), `data.presetData[4].{bank, data[128]}`, `data.controllerData.{midiChannel, connectors[14]{id,pos,name,shortName,trails,inputName,outputName}, deviceId, inputRingSwapPin, inputSplit, loopBypassPersistent}`.
- `matrixArray` routing semantics are not decoded by anyone public. **A native ML10X preset/backup export is therefore blocked.** A defensive reader of the shape is possible.

## 5. External control
No expression/aux jacks; control via MIDI (PC/CC/SysEx) or front panel. MC-series "ML10X" message type: "Selected loops will be engaged, while non-selected loops are bypassed", toggle selected loops (simple only), scroll/recall presets — DOCUMENTED (excerpt).

## Contradictions / open questions
1. Advanced-mode per-loop bypass: pre-v1.2 "cannot"; v1.2 beta "can" via editor double-click; CC table still says loop CCs are Simple-only; third-party wire-format notes say per-loop bypass bytes are ignored in Advanced presets. Whether CC 10–29 affect Advanced presets on v1.2 is UNVERIFIED → feature-gated in Signal Loom.
2. v1.2 is still labelled BETA on GitHub.
3. CC 30–39 value polarity contradicted.
4. Factory default MIDI channel and Device ID unknown.
5. Preset name length 16 vs 12 bytes.
6. openmidi lists a "MIDI OUT" jack; spec sheets list In + Thru only. Treat as data error.
