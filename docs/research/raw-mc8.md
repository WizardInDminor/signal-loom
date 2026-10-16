# Raw reconnaissance notes: Morningstar MC8 (original, not Pro)

Collected 2026-10-15 by a research agent. **Network caveat:** Morningstar-owned hosts were
unreachable from the sandbox (DNS/proxy). Evidence labels:
- DOCUMENTED (snippet): official Morningstar page text seen only through search-engine snippets.
- DOCUMENTED (fetched): official Morningstar GitHub content read directly.
- THIRD-PARTY: GitHub repos, forum, retailers.
- SAMPLE: computed from three real MC8 editor export files (public repo bwanab/MC8_setups).

## 1. Hardware / capacity
- **30 banks**, "30 dual-page banks of 8 switches" (page toggle via B+C). https://www.morningstar.io/mc8-midi-controller — DOCUMENTED (snippet). SAMPLE: 30 bank objects, `bankNumber` 0–29.
- **22 switch presets + 4 expression presets per bank.** https://help.morningstar.io/en/article/mc8-user-manual-1fzlzjx/ — DOCUMENTED (snippet). SAMPLE: `presetArray` 22 (`presetNum` 0–21), `expPresetArray` 4.
- Labels: footswitches A–H; Page 1 = A–H, Page 2 = I–P; Q–V reachable only via external aux switches — manual (manualslib mirror) THIRD-PARTY mirror of official text.
- MC8 PRO differs (128 banks x 3 pages, 24 presets A–X, 32 messages). Never substitute.
- 8 footswitches; 4 x 1/4" TRS Omniports (each: TRS MIDI out, aux-switch in, or expression in); 5-pin MIDI In; MIDI Out/Thru DIN (7-pin socket with phantom power on 6/7, 5-pin compatible); USB-B class compliant; 40x4 LCD — DOCUMENTED (snippet).
- Omniport TRS MIDI modes: "MIDI Out – Standard" (tip = MIDI, ring powered), "Tip Active", "Ring Active", "MIDI Out – Type B" (ring = MIDI, tip powered); selectable in menus/editor since firmware v3.8; "only use stereo TRS cables"; Omniports cannot send SysEx — DOCUMENTED (snippet).

## 2. Message limits and name lengths
- **16 messages per switch preset** (non-Pro). https://help.morningstar.io/en/article/executing-more-than-1632-messages-per-preset-1pzvabn/ and the Editor User Guide 1.3.6 — DOCUMENTED (snippet). SAMPLE: every `msgArray` has 16 slots.
- 16 messages per expression preset — SAMPLE; official statement UNVERIFIED.
- **16 bank messages** (On Enter / On Exit) — DOCUMENTED (manual + v3.7.1 release notes). A help article says 32 (Pro figure).
- Each message has **4 data bytes** (`d1..d4`) — THIRD-PARTY staff post + SAMPLE.
- Preset Rename message limited to 4 characters on MC8 — DOCUMENTED (snippet).
- Name lengths: short name 10 (forum + SAMPLE max 10), toggle name 9 (SAMPLE max), long name 23 (SAMPLE max), bank name 24 (SAMPLE max, looks truncated) — official limits UNVERIFIED. ASCII only — THIRD-PARTY.

## 3. Message types, actions, toggle semantics
- Message types (official): PC, PC Multi Channel, CC, Note On/Off, Real Time, Song Position/Select, SysEx, MMC, MIDI Clock, MIDI Clock Tap, PC Scroll, CC Value Scroll, Bank Up/Down, Bank Jump, Bank Change Mode, Toggle Page, Set Toggle (Engage/Disengage/Toggle), Toggle Preset, Delay (10 ms steps), Engage Preset, Trigger Messages, Preset Rename, Looper Mode, MIDI Thru, CC Waveform Generator, CC Sequencer, Keystrokes, Utility, Kemper/Axe-FX Tuner, Strymon Bank Up/Down, Select Exp Message, **ML10X**, Multi Engage/Bypass — https://help.morningstar.io/en/article/message-types-1du3iiv/ , https://manuals.morningstar.io/mc-midi-controller/Message-Type-List.181698784.html — DOCUMENTED (snippet); release notes DOCUMENTED (fetched).
- Export type codes `t`: SAMPLE confirms 0 = empty, 1 = PC, 2 = CC. Other codes from the MC8 Pro Go SDK (THIRD-PARTY, unverified for MC8): 3 Note On, 4 Note Off, 10 Bank Up, 11 Bank Down, 13 Bank Jump, 14 Toggle Page, 15 Set Toggle, 22 Toggle Preset, 23 Delay, 27 Engage Preset, 39 ML10X, 42 Trigger Messages, 44 Preset Rename.
- Action types: Press, Release, Long Press (>600 ms default), Long Press Release, Double Tap, Double Tap Release, Long Double Tap, Long Double Tap Release, Release All, Long Press Scroll; "Press will also be triggered when you perform a Long Press". https://help.morningstar.io/en/article/action-types-6h5mav/ — DOCUMENTED (snippet).
- Action codes `a` (from MC8 CC implementation chart): 0 Do Nothing, 1 Press, 2 Release, 3 Long Press, 4 Long Press Release, 5 Double Tap, 6 Double Tap Release*, 7 Long Double Tap*, 8 Long Double Tap Release*, 9 Release All, 10 Long Press Scroll (* inferred from Pro SDK). SAMPLE observed a in {0,1,3,5}.
- Toggle: each preset has Pos 1 / Pos 2; enable "Preset Toggle"; each message tagged Pos 1 / Pos 2 / Both. Export `tg`: 0 = Pos 1, 1 = Pos 2, 2 = Both (SAMPLE; names from Pro SDK). Preset flags `toToggle`, `toBlink`, `toMsgScroll`, `toggleGroup`. Bank `bankClearToggle`. — DOCUMENTED (snippet) + SAMPLE.

## 4. Data ranges
- MIDI channel 1–16, one-based in UI and export (`c`) — DOCUMENTED + SAMPLE.
- PC number 0–127 zero-based in the editor: "typically PC#0 recalls preset 1" — DOCUMENTED (snippet).
- CC number/value 0–127 — standard 7-bit; SAMPLE consistent.
- MIDI channel names (v3.6.1+), stored in `controller_settings.midi_channels[16]`.

## 5. Bank-level settings
Bank name; Bank Presets (16 messages On Enter / On Exit); Clear Toggles; copy/swap. No per-bank clock. Global settings keys observed in SAMPLE `general_configurations`: dualLock, midiClockPersist, lcdAlign, midiThru, ignoreMidiClock, crossMidiThru, savePresetToggle, midiChannel, switchSensitivity, bankChangeDelayTime, bankChangeDisplayTime, longPressTime, loadLastBankOnStartup, numMidiCable, midiSendDelay, midiClockOutputPorts.

## 6. Firmware / editor
- Latest MC8 firmware **v3.13.6** (2025-08-29). https://github.com/Morningstar-Engineering/MC8-MIDI-Controller/releases — DOCUMENTED (fetched).
- Editor: web editor primary; Desktop Editor MKII v3.13.3 latest; from v3.11 editor version must match firmware. https://github.com/Morningstar-Engineering/Desktop-Editor-MKII/releases — DOCUMENTED (fetched). Editor User Guide 1.3.6 page says it is not kept up to date.
- Counts (30 banks / 22+4 presets / 16 messages) unchanged across 3.x.

## 7. Editor backup / export format (REAL FORMAT)
- Official how-to: Editor -> "Controller Backup" tab -> "Current Bank" or "All Banks"; restore via "Restore your data" -> choose file. Per-preset Save/Load as .json. https://help.morningstar.io/en/article/morningstar-editor-user-manual-81kpjn/ — DOCUMENTED (snippet).
- Real public samples (THIRD-PARTY, no license file in that repo, so NOT vendored here): https://github.com/bwanab/MC8_setups — `Morningstar_MC8_All_Banks_Backup_20250202_112454.json` (1,053,833 bytes) and `Morningstar_MC8_Bank_Backup_Mainstage FX_20250202_112517.json` (35,025 bytes). Minified single-line JSON.
- Verbatim head (single bank):
  `{"schemaVersion":1,"dumpType":"singleBank","deviceModel":4,"downloadDate":"2025-02-02T16:25:17.814Z","hash":-47904847,"data":{"bank":{"bankNumber":0,"bankName":"Mainstage FX","bankClearToggle":false,"bankMsgArray":[{"d1":0,"d2":0,"d3":0,"d4":0,"m":0,"c":1,"t":0,"a":0,"tg":0,"mi":""}, …`
- Verbatim head (all banks):
  `{"schemaVersion":1,"dumpType":"allBanks","deviceModel":4,"downloadDate":"2025-02-02T16:24:54.810Z","hash":1798973137,"data":{"bankArray":[{"bankNumber":0,"bankName":"Mainstage FX",…`
- Real message example: `{"d1":49,"d2":0,"d3":0,"d4":0,"m":0,"c":1,"t":2,"a":1,"tg":0,"mi":""}` (CC#49, Press, Pos 1).
- Schema (SAMPLE): top level `schemaVersion` 1, `dumpType` "singleBank"|"allBanks", `deviceModel` 4 (= MC8), `downloadDate` ISO UTC, `hash` signed 32-bit, `data`, `description` (last key). `data` = `{bank}` or `{bankArray[30], controller_settings}`. Bank: `bankNumber` (0-based), `bankName`, `bankClearToggle`, `bankMsgArray[16]`, `presetArray[22]`, `expPresetArray[4]`. Preset: `presetNum`, `bankNum`, `isExp`, `shortName`, `toggleName`, `longName`, `toToggle`, `toBlink`, `toMsgScroll`, `toggleGroup`, `msgArray[16]`. Message: `d1..d4`, `m` slot, `c` channel 1–16, `t` type, `a` action, `tg` toggle position, `mi` "" (purpose unverified). Files are fully padded (every slot present even if empty).
- **Integrity:** `hash` = Java-style `String.hashCode` (h = 31*h + charCode, signed 32-bit) over the compact JSON serialization of the `data` object exactly as it appears in the file. Reproduced for all three sample files (all-banks: 1798973137). SAMPLE (own computation). Whether the editor rejects a bad hash: UNVERIFIED.
- Pro format differs (`data[18]`, 32 msgs, 24 presets, 128 banks, extra keys). Do not reuse.

## 8. MIDI the MC8 receives
- Receives PC, CC, Note, MIDI Clock. PC#n = jump to bank n+1. CC chart: CC#0 Bank Up, CC#1 Bank Down, CC#2 Set Toggle, CC#3 Clear Toggle, CC#4 Toggle Page, CC#5/6 BPM MSB/LSB, CC#7 Looper Mode, CC#8 Tap Tempo, CC#10 onward Engage Preset A… (value = action code), CC#51–54 expression presets — DOCUMENTED (snippet, rows partially cut).

## Contradictions / open questions
1. Bank messages 16 vs 32 (32 is Pro). Use 16.
2. MIDI Out 5-pin vs 7-pin socket: treat as 7-pin socket, 5-pin compatible.
3. Official name-length limits not found; only sample maxima.
4. `t`/`a`/`tg` codes beyond observed values come from the Pro SDK.
5. Web-editor URL and whether the editor validates `hash` could not be checked (hosts blocked).
