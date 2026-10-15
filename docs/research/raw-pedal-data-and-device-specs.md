# Raw reconnaissance notes: pedal datasets and device physical specs

Collected 2026-10-15 by a research agent during Session 1. **Network caveat:** the session's
network policy denied every non-GitHub host (morningstar.io, manuals.morningstar.io,
help.morningstar.io, strymon.net, earthquakerdevices.com, pedalplayground.com, archive
mirrors). Only github.com / raw.githubusercontent.com were reachable. Therefore:

- Part A (Pedal Playground) is **fully verified** from raw GitHub files.
- Part B (device specs) relies on **web-search result snippets** attributed to official pages.
  "DOCUMENTED (snippet)" means the search engine quoted that text from an official URL but the
  page itself was never opened. Treat these as *needs one-click confirmation*.

## Part A — Pedal Playground (https://github.com/PedalPlayground/pedalplayground)

### License: none
- No `LICENSE`, `LICENSE.md`, `LICENSE.txt` or `COPYING` at the repo root (all 404 on raw).
- `package.json` carries `"license": "ISC"`, `"author": "Travis Lehman"` — npm metadata only,
  no accompanying license text; at best it covers code, not the dataset or images.
- `README.md` has no licensing, attribution or reuse terms; it is a contributing guide.
- **Conclusion:** default copyright applies. Redistribution of `pedals.json` and the images is
  not expressly permitted. Bare dimensions are facts, but the compiled JSON and the images are
  not ours to bundle. Signal Loom therefore does **not** vendor any Pedal Playground record or
  image. It ships an import path for the format (user supplies their own copy) and
  hand-authored example profiles with manufacturer source URLs.
- Attribution if permission is ever obtained: "Pedal Playground (Travis Lehman),
  https://github.com/PedalPlayground/pedalplayground".

### Images are third-party product photos
README instructs contributors to find a top-down product photo, cut it out, and save PNGs to
`/app/images/pedals` and `/public/images/pedals`. No rights clearance is recorded. **Do not
redistribute the images.**

### Data format (verified from `public/data/pedals.json`, raw.githubusercontent.com, master)
- Top-level JSON array of ~8,557 objects. Fields on every record: `Brand`, `Name`, `Width`,
  `Height`, `Image`.
- Units: **inches**, rounded to nearest hundredth.
- `Height` is the **top-down depth** (front-to-back), not vertical height. No vertical height,
  weight, jack, or power fields.
- README: "Dimensions recorded should include any jacks and protrusions" — but consistency is
  unreliable: `Morningstar ML10X` W 6.65 H 2.49 equals the official 169 mm bare enclosure, and
  `Morningstar MC8` W 8.82 equals the official 224 mm enclosure. Treat jack inclusion as unknown.
- Verbatim examples:
  `{"Brand": "Strymon", "Name": "Sunset", "Width": 4, "Height": 4.55, "Image": "strymon-sunset.png"}`
  `{"Brand": "Morningstar", "Name": "MC8", "Width": 8.82, "Height": 4.82, "Image": "morningstar-mc8.png"}`
  Others: `Strymon BigSky MX` 7 x 4.95; `EarthQuaker Plumes` 2.6 x 4.94 (brand "EarthQuaker");
  `Meris Enzo` 4.25 x 4.5; `Chase Bliss MOOD MKII` 2.86 x 4.86.

### Other datasets
- caedonhsieh/pedalboard-3d: `data/heights.json` (8,550 vertical heights with confidence
  levels). No LICENSE file found. Fetches Pedal Playground data live at runtime.
- KrDPNsk/PedalboardPlanner: MIT (code). No confirmed dataset.
- mpragliola/pedalboard-planner, ricardoaxel/pedalvision: no LICENSE found at standard paths.
- **No pedal-dimension dataset with an explicit CC/MIT license was found.** Enclosure
  datasheets (Hammond 1590B/BB/125B) are the license-free fallback for bare-enclosure sizes.

## Part B — Device specs (snippet-level evidence unless stated)

### Morningstar MC8 (original)
Pages: https://www.morningstar.io/mc8-midi-controller , https://shop.morningstar.io/products/MC8-p161734004 ,
https://manuals.morningstar.io/mc-midi-controller/MC8-User-Manual.929989199.html
- Dimensions **224 x 125 x 50 mm** (8.9 x 5 x 2 in) — DOCUMENTED (snippet). Jack inclusion not stated.
- Weight 860 g — DOCUMENTED (snippet, seen once).
- Power **9 VDC centre negative, min 250 mA**; USB bus-powerable; MIDI phantom power on
  MIDI OUT pins 6/7 — DOCUMENTED (snippet). Retailer: "9-12V DC" — THIRD-PARTY.
- Jacks: 1 x 5-pin MIDI In; 1 x 5-pin MIDI Out/Thru; **4 x 1/4" TRS Omniports** (each
  configurable as TRS MIDI Out, expression in, or aux switch in); USB Type B; DC in. No audio.
  — DOCUMENTED (snippet).
- Omniport TRS MIDI: tip/ring selectable in software since firmware v3.8 (no jumpers) —
  DOCUMENTED (snippet). "Type A/B" wording only found for the MC8 PRO.
- Incoming MIDI chart: not retrieved — UNKNOWN.

### Morningstar ML10X
See `raw-ml10x.md`. Dimensions **169 x 58 x 58 mm enclosure**; weight 439–450 g (official
figures conflict); power **9–18 VDC centre negative, min 160 mA**; 1 x stereo TRS in,
5 x stereo TRS send, 5 x stereo TRS return, 1 x stereo TRS out; 5-pin MIDI In + Thru; USB-C.

### Strymon Sunset
Pages: https://www.strymon.net/product/sunset/ , manual https://www.strymon.net/manuals/Sunset_UserManual_RevC.pdf ,
MIDI FAQ https://www.strymon.net/faq/control-sunset-with-midi/
- Dimensions 4.5" deep x 4" wide x 1.75" tall (11.4 x 10.2 x 4.4 cm) — THIRD-PARTY (retailers
  reproducing Strymon spec text; not confirmed on strymon.net). Jack inclusion not stated.
- Weight — UNKNOWN (retailers conflict 408 g vs 610 g).
- Power **9 VDC centre negative, 250 mA min** — DOCUMENTED (snippet).
- Jacks: IN, OUT (1/4" mono), FAV (TRS), EXP (TRS), 9VDC. No DIN MIDI, no USB.
- MIDI via EXP jack (TRS) with Strymon MIDI EXP cable / Conduit / compatible interface;
  firmware 1.20+; EXP set to MIDI mode by holding A at power-up — DOCUMENTED (snippet).
- MIDI: default channel 1; 300 preset locations via PC; MIDI bank 0 at power-up; CC 0 bank
  select for presets beyond 127; PC does not change bypass; **bypass A = CC 10, B = CC 15
  (0 = bypass, 1–127 = engage)** — DOCUMENTED (snippet, strymon.net MIDI post). Expression
  CC 100 — UNVERIFIED for Sunset. Full knob CC chart — UNKNOWN.

### Strymon BigSky MX
Pages: https://www.strymon.net/product/bigsky-mx/ , manual https://www.strymon.net/manuals/BigSky_MX_UserManual_RevB.pdf
- Dimensions **5" deep x 7" wide x 1.87" tall** — DOCUMENTED (snippet). Jack inclusion not stated.
- Weight — UNKNOWN (685–800 g, conflicting third-party).
- Power **9 VDC centre negative 2.1 mm, 500 mA min** — DOCUMENTED (snippet).
- Audio: stereo in/out; whether TRS or dual TS — UNKNOWN.
- Jacks: 5-pin MIDI IN and OUT; EXP (TRS; Preset/Bank/MIDI modes); USB-C — DOCUMENTED (snippet).
  TRS MIDI type on EXP — UNKNOWN.
- MIDI: expression CC 100 — DOCUMENTED (snippet, MX manual). 300 presets (100 banks x A/B/C);
  PC 0 -> 00A, 1 -> 00B...; CC 0 bank select 0/1/2 — DOCUMENTED for original BigSky,
  UNVERIFIED for MX. Bypass **CC 102 (0 bypass, 127 engage)** — DOCUMENTED (snippet) for the
  BigSky family, UNVERIFIED for MX specifically (manual p.70 not read).

### EarthQuaker Devices Plumes
Page: https://www.earthquakerdevices.com/plumes
- Dimensions **4.75 x 2.50 x 2.25 in (121 x 64 x 57 mm) with knobs** — DOCUMENTED (snippet).
- Weight — UNKNOWN. Power **9 VDC 2.1 mm centre negative, 25 mA** — DOCUMENTED (snippet).
- Jacks: mono in, mono out, DC — THIRD-PARTY (inferred). No MIDI/EXP/USB. Flexi-Switch relay bypass — THIRD-PARTY.

### Meris Enzo (optional) — all THIRD-PARTY
108 x 114 x 50 mm (conflicting); 9 VDC centre negative < 150 mA; TRS input (stereo/mono
switchable), 2 x mono outs, EXP TRS jack doubles as MIDI (needs Meris MIDI I/O). MIDI chart UNKNOWN.

### Chase Bliss MOOD MKII (optional)
Page: https://www.chasebliss.com/mood-mkii — 9 VDC centre negative ~270 mA (DOCUMENTED snippet);
stereo I/O; MIDI over 1/4" TRS (MIDIBox for 5-pin); dimensions ~74 x 124 x 60 mm incl.
protrusions — THIRD-PARTY; weight UNKNOWN.
