# Research and compatibility report (Session 1)

Compact record of what was verified, from where, and at what level of evidence. Raw agent
reports with every URL are in `docs/research/raw-*.md`.

## Evidence vocabulary (used everywhere in this repo and in the UI)

| Level | Meaning |
|---|---|
| **Documented** | Described in official/current vendor material. In Session 1 the build sandbox could not open any Morningstar, Strymon or EQD host (DNS/proxy denied), so "documented" facts were obtained through search-engine excerpts of the official pages or from official GitHub repositories. Treat each as *needs one-click confirmation in a browser*. |
| **Fixture-validated** | Tested against a real exported file with known results. |
| **Editor-validated** | Imported into the official editor and inspected. **Not achieved in Session 1** (no editor access from the sandbox). |
| **Hardware-validated** | Tested on the user's MC8 / ML10X. **Not achieved in Session 1** (no hardware). |
| **Unverified** | Hypothesis or untested implementation. |

Nothing in Signal Loom reports a stronger level than the one earned.

## 1. Pedal datasets and licensing

**Pedal Playground** (https://github.com/PedalPlayground/pedalplayground): no LICENSE file;
`package.json` says ISC (code metadata only); README has no reuse terms; images are cut-out
product photos of unknown provenance. Format: JSON array of `{Brand, Name, Width, Height,
Image}` in inches, `Height` = top-down depth, jack inclusion inconsistent (ML10X 6.65" and MC8
8.82" match bare enclosures despite the README rule).

**Decision:** nothing from Pedal Playground is vendored — no records, no images. Signal Loom
ships (a) a defensive importer for the format (`backend/app/catalog/pedalplayground.py`,
`POST /api/catalog/import/pedalplayground`) that marks every record *third-party* with
unknown jack inclusion and no ports/power/MIDI, and (b) ten hand-authored profiles with
source URLs and per-attribute evidence. Other datasets found (pedalboard-3d heights,
PedalboardPlanner, pedalvision) also lack usable data licenses; none was used.

### User-supplied pictures (Session 3)

Device photographs are supplied by the user and stored only on their computer (managed asset
directory, never in the repository or a project file unless they opt in). The app does not fetch
or redistribute Pedal Playground's or any vendor's product photography, and uploading a picture is
not taken as proof of redistribution rights: the UI says so next to the upload control. The test
fixture `pedal-photo.jpg` is a synthetic drawing made with Pillow for this repository.

## 2. Device profile facts shipped (evidence per attribute)

| Device | Footprint | Power | Jacks / MIDI | Unknown on purpose |
|---|---|---|---|---|
| Morningstar MC8 (original) | 224 × 125 × 50 mm — documented (snippet) | 9 VDC CN, ≥250 mA — documented | 5-pin In, Out/Thru (7-pin socket), 4 TRS Omniports (MIDI out Standard/Type B, exp in, aux in), USB-B — documented | jack inclusion, jack positions (estimated), own receive channel default |
| Morningstar ML10X | 169 × 58 × 58 mm enclosure — documented | 9–18 VDC CN, ≥160 mA — documented | 1 stereo TRS in, 5 TRS send + 5 TRS return (Tip/Ring = 10 mono loops), 1 stereo TRS out, 5-pin In + Thru, USB-C — documented; CC table rows 0,4–10,20 documented, 11–19/21–29 from the Morningstar-hosted openmidi repo | factory default MIDI channel, positions, weight (439 vs 450 g) |
| Strymon Sunset | 4 × 4.5 × 1.75 in — third-party (retailer copies) | 9 VDC CN, 250 mA — documented | mono in/out, FAV, EXP (MIDI only via Strymon MIDI EXP cable / Conduit, fw 1.20+) — documented; bypass CC 10 (A) / CC 15 (B), 0 = bypass — documented; CC 100 exp unverified | official dimensions, weight, knob CC chart |
| Strymon BigSky MX | 7 × 5 × 1.87 in — documented | 9 VDC CN 2.1 mm, 500 mA — documented | stereo in/out (TS vs TRS unknown), MIDI In/Out DIN, EXP TRS, USB-C — documented; CC 100 exp documented; bypass CC 102 and bank mapping — third-party (BigSky family, not MX manual) | weight, jack format, TRS-MIDI type, MX-specific CCs |
| EarthQuaker Plumes | 121 × 64 × 57 mm with knobs — documented | 9 VDC CN, 25 mA — documented | mono in/out — third-party; **jack positions deliberately unknown** | positions, weight, jack inclusion |
| Generic mono/stereo effect, PSU, guitar, amp | approximate / user placeholders | unknown unless user-set | user-editable | everything flagged |

## 3. Morningstar MC8 (original) — findings that shape the compiler

- 30 banks; 22 switch presets (A–V) + 4 expression presets per bank; 8 footswitches × 2 pages
  (A–H, I–P); Q–V reachable only via aux switches. Documented + confirmed in real exports.
- 16 messages per preset; 16 bank messages; 4 data bytes per message. Documented (non-Pro).
- PC numbers 0–127 zero-based in the editor; channels 1–16. Documented.
- Action codes (Press = 1 …) documented via the MC8 CC implementation chart; toggle position
  codes (Pos1 0 / Pos2 1 / Both 2) from real exports; message type codes 0/1/2 confirmed in real
  exports, other codes only from an MC8 Pro SDK (used for *reading* foreign files only).
- Name length limits are **not** documented; the app warns at the maxima observed in real
  exports (short 10, toggle 9, long 23, bank 24) and labels them unverified.
- Latest firmware 3.13.6 (2025-08-29). Editor and firmware versions must match from 3.11.
- MC8 Pro limits (128 banks, 24 presets, 32 messages, `data[18]`) are explicitly *not* used.
- **Footswitch face (Session 3).** The Stage draws the MC8 as two rows of four switches per
  page with A–D along the bottom and E–H above (I–P on page 2), which is how the device's
  display labels them. Evidence: THIRD_PARTY/approximate (product images and editor screenshots,
  not the manual's text, and not hardware-validated). The drawing is a picture of the *plan*;
  the app never sends anything to a controller.

### MC8 editor backup format — fixture-validated

Three real exports published in a third-party repository (bwanab/MC8_setups; no license, so
not redistributed; `backend/scripts/fetch-fixtures.sh` downloads them for local tests) were
analysed:

- Top level `schemaVersion: 1`, `dumpType: singleBank | allBanks`, `deviceModel: 4` (MC8),
  `downloadDate`, `hash`, `data`, `description`. Fully padded slots. Minified single line.
- `hash` = Java `String.hashCode` over the compact JSON of `data` — reproduced on all three
  files; and our serializer reproduces the file bytes exactly (test
  `test_real_editor_exports_round_trip`).
- Signal Loom writes **singleBank** files only (restoring one replaces that bank only), emits
  **PC/CC only**, refuses to write when any compile error exists, and self-checks the result.
- **Not** achieved: loading a generated file into the Morningstar editor (editor-validated) or
  restoring it to an MC8 (hardware-validated). Whether the editor validates `hash` is unknown.

## 4. Morningstar ML10X — findings that shape the topology model

- 5 TRS loops, each Tip/Ring independently routable = 10 mono loops; a stereo pedal uses Tip =
  L and Ring = R of one loop via a TRS-to-dual-TS splitter. Modelled as per-conductor ports
  with a `pair_group`, so the planner can say "both conductors used → splitter cable needed".
- 4 banks × 128 presets; `PC n` recalls preset n of the *current* bank; `CC#0` 0–3 selects the
  bank. The compiler always sends bank + PC (absolute state).
- Simple presets: mono series chain; per-loop bypass saved with the preset; per-loop CC 10–19
  (0–63 bypass / 64–127 engage) and toggle CC 20–29 work **only in Simple presets** and only for
  loops that are part of the current preset.
- Advanced presets: split/merge, editor-only. Pre-1.2 manual: loops cannot be bypassed.
  **Firmware 1.2 (still labelled BETA on GitHub)** adds per-loop engage/bypass saved in Advanced
  presets (editor double-click). Whether CC 10–29 act on an Advanced preset on 1.2 is
  **unverified** (official table still says Simple only; forum reports fragility).
  → `ml10x_feature_gate()` enables *editor-saved* Advanced bypass on ≥1.2 and keeps *CC-driven*
  Advanced bypass disabled with an explanatory error, instead of a blanket prohibition.
- No expression/aux jacks; MIDI In + Thru only (an openmidi "MIDI OUT" row is a data error).
- Factory default MIDI channel: not found → instance must set it; the compiler errors otherwise.
- Contradictions recorded: CC 30–39 output-cut polarity; preset name 16 vs 12 bytes; "Mute"
  semantics.

### ML10X routing field: Session 2 analysis

The one real backup available locally (512 presets) contains only three non-empty presets;
their `matrixArray` entries (`{"0": [4,0,0]}`, `{"0": [0,64,0], "2": [4,0,0], "3": [2,0,0],
"8": [1,0,0]}`, …) do not map onto the 14-connector numbering in any consistent way, and a
third-party wire-format note says the device rebuilds this matrix from per-connector chain
segments that the JSON backup does not include. With three samples and no controlled pair of
exports there is no basis for a decoder. Session 2 therefore ships the **backup comparison
tool** (`POST /api/rigs/inspect/backup-diff`, Exports tab) so the user can produce the
controlled pairs (change one loop, export again) that a decoder would need. Status unchanged:
**blocked**, read-only inspector only.

### ML10X editor backup format — blocked for writing

One real `dumpType: full` backup (deviceModel 7, 4 × 128 presets, 14 named connectors,
`midiChannel`, `deviceId`, `inputSplit`, `loopBypassPersistent`) exists in a GPL-3.0
third-party repository (ragb/ml10x-access-rs). Its per-preset `matrixArray` (16 × 3 ints)
encodes the routing and **nobody public has decoded it**; the file `hash` algorithm for this
model is unverified. Therefore Signal Loom does **not** write ML10X files. It ships a defensive
*reader* (`POST /api/rigs/inspect/ml10x-backup`) validated locally against that file (not
committed because of its license) and a synthetic-shape test. Native ML10X export status: **blocked**.

### MC8 bank import (Session 2)

`bank_dump_to_plan` reads an editor "Current Bank" file into Signal Loom's MC8 plan. On the
real public fixture (`Mainstage FX`) every PC/CC message slot round-trips byte-for-byte through
export (`test_real_mc8_bank_round_trip`). Message types other than PC/CC are listed as skipped
with their third-party type name. Evidence level for import: **fixture-validated** on PC/CC
content; names are carried verbatim; expression presets and bank messages are not imported.

## 5. What the user can do to raise the evidence level

1. **MC8, editor-validated:** in the Morningstar editor, *Controller Backup → All Banks* (keep
   this file safe). Export bank 1 from Signal Loom's Exports tab, then *Controller Backup →
   Restore* with the generated **single-bank** file into an unused bank, inspect each switch in
   the editor **without** saving to the controller, and report whether it loads and what the
   editor shows. Also please share one *Bank Backup* of an unmodified empty bank: it lets us
   confirm empty-slot defaults byte-for-byte. These files contain only switch names and MIDI
   messages; no credentials. Never share device serials if the editor includes them.
2. **MC8, hardware-validated:** only after step 1, and only with the All-Banks backup at hand:
   save the bank to the controller, press A/B/C with a MIDI monitor on the Out jack, and
   compare against the switch map CSV.
3. **ML10X:** export a *Device Backup* from the ML10X editor and load it into Signal Loom's
   inspector (read-only). If you additionally create two presets whose routing differs by one
   known loop and export again, the `matrixArray` difference can be used to start decoding the
   routing field — the prerequisite for any native ML10X export.
4. **Direct page confirmation:** open the official manual pages listed in
   `docs/research/raw-*.md` and confirm the "documented (snippet)" rows; any correction is a
   one-line change in `backend/app/morningstar/specs.py` or `backend/app/catalog/builtin.py`.

## 6. Stack choices

Next.js 16 / React 19 / TypeScript with zustand; plain SVG for the board and the signal
diagram (predictable geometry, no heavy canvas dependency; React Flow/Konva were evaluated
and rejected for Session 1 as unnecessary). FastAPI + Pydantic v2 + SQLite with file-based
migrations. Pytest (64 tests) and Playwright (20 scenarios) cover the rules and the demo path.
