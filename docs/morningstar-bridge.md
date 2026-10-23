# Morningstar Bridge (Session 7)

Import, understand, compare and — where the format is already validated — export native Morningstar
MC8 (original) and ML10X editor backup files. The official Morningstar editors remain the tools that
program the hardware; the bridge is for interoperability, workflow consolidation and preservation
of a controller's configuration. Workspace: **Morningstar Bridge** in the top navigation
(`/morningstar`). Backend: `backend/app/morningstar/mc8_native.py`, `ml10x_native.py`,
`backend/app/api/morningstar.py`. Tests: `backend/tests/test_morningstar_bridge.py`,
`frontend/e2e/morningstar.spec.ts`.

## 1. Architecture decisions

### Three layers, never merged

| Layer | Definition | Code |
|---|---|---|
| **Native snapshot** | The file exactly as the editor wrote it. The parsed `data` object is kept whole; byte-exactness (`compact_json(doc) == file`) and the integrity hash are checked; every key Signal Loom has not seen in a real export is **listed** with its path and a value preview. Nothing is dropped, nothing is renamed. | `load_native()` in both modules |
| **Interpreted configuration** | Signal Loom's reading of the fields whose meaning is established. Every message, setting and code carries an evidence level: `sample` (reproduced from real MC8 exports), `documented` (official material via `docs/research.md`), `third_party` (MC8 Pro SDK / the editor bundle's enum as read by a third party), `named` (self-describing key, semantics unverified), `unknown`. A message of an unsupported type is still shown — by its third-party name, with its raw bytes — and counted as *not modelled*. | `interpret_*()`, `inspect()` |
| **Proposed modification** | Edits to an **allow-list** of known fields (bank name/clear-toggle, preset names/flags/toggle group, PC/CC message `d1 d2 c t a tg`), applied to a copy of the native data. The result is a structural diff against the original plus a self-checked `singleBank` file. Everything else — other message types, `d3`/`d4`/`mi`, unknown keys at any level — rides along verbatim. A slot holding a type Signal Loom cannot model is locked. | `propose()`, `backup_diff.diff_objects()` |

The compare view sits between the first two layers: the rig's compiled MC8 bank is rendered through
the validated writer so both sides are compared in the editor's own vocabulary (`compare_bank_to_plan`).
Messages the rig cannot express are reported as *controller only*, never as *to be removed*.

### Boundaries kept

- **Stateless API.** `/api/morningstar/*` takes the file text in the request and returns a report.
  No new tables, no stored files, no change to the rig document (the existing `import/mc8-bank`
  route stays the way to put a bank into a rig). The browser keeps the file text.
- **No new output format.** The only file produced is the `singleBank` shape the Session 1 writer
  already validated against real exports. An `allBanks` input can have one bank object lifted
  verbatim into such a file (same shape, fresh hash and date). No `allBanks` output, no ML10X output,
  no SysEx, no hardware I/O.
- **Separation from Team A.** New modules and components only; the shared `lib/api.ts`,
  `lib/types.ts`, `models/rig.py` and the compiler are untouched. Two one-line registrations:
  the router in `app/main.py` and the navigation link in `layout.tsx`.
- **Payload discipline.** An all-banks file has 12,480 message slots; a clean empty slot is reported
  as `{slot, status: "empty"}` so the full interpretation of a real all-banks export is ~1.5 MB.

## 2. Format findings established in this session

### MC8 (deviceModel 4) — fixture-validated on three real editor files

- Shape inventory of the all-banks export: 30 banks × (22 switch + 4 expression presets × 16 message
  slots + 16 bank message slots) and `controller_settings` with nine sections: `omniports` (4),
  `resistor_ladder_aux` (8), `controller_settings/general_configurations` (16 keys), `waveform_engines`
  (4), `sequencer_engines` (2), `scroll_counters` (16), `midi_channels` (16: `name`, `channel`,
  `sendToPort`, `remap`), `bank_arrangement` (30 + `isActive`, `numBanksActive`), `midi_events` (16).
- Observed codes: `t` ∈ {0, 1, 2}; `a` ∈ {0, 1, 3, 5}; `tg` ∈ {0, 2}; `d3` = `d4` = 0 everywhere;
  `mi` = `""` everywhere; bank and expression message slots all empty. Longest names: bank 18,
  short 10, toggle 8, long 17. These bound what the fixtures can prove; the UI says "longest seen in
  real exports" rather than "limit".
- Message type codes beyond 0/1/2 are named from the editor bundle's 47-entry enum
  (`M_EMPTY` … `M_DEVICE_ENGAGE_BYPASS`) as read by a third party. They are **names for display**,
  never emitted; the compiler still writes PC/CC only.
- Both real files re-serialize byte-for-byte and interpret with zero anomalies and zero unknown keys.

### ML10X (deviceModel 7) — one real backup, analysed locally

The only public real file is in a GPL-3.0 third-party repository (ragb/ml10x-access-rs) together
with captured device SysEx. It is not vendored; it was compared locally with the captures.

1. **Integrity hash.** `hash` = Java `String.hashCode` over the compact JSON of `data` — the MC8
   algorithm — reproduces on that file (424497435). Evidence: **1 sample**; the reader reports a
   mismatch as a warning, never a refusal.
2. **`matrixArray` is the device's preset segments 48–63.** For the three presets with routing data
   (`Base`, `Clean`, `Empty` #2) the JSON `matrixArray["k"]` equals the 3 bytes of segment `48+k`
   in the device's preset-data message. (The JSON's `Empty` #2 carries one extra row, `15: [1,0,0]`,
   which the earlier capture lacks — the file was exported later.)
3. **The explicit routing records are not in the backup.** On the wire a preset carries connection
   records `[from, to, flag]` keyed by connector (segments 0–13) *and* the matrix. The Device Backup
   JSON carries only the matrix. So routing in a backup is recoverable only through `matrixArray`.
4. **Row observation.** In all three presets the non-zero matrix rows are exactly the connectors that
   have an outgoing link in the chain, in the order Input Tip, Input Ring, A Tip, A Ring, B Tip … E Ring
   (rows 0–11; 8 of 8 rows). Rows 12–15 were not observed with data except the later `15` above.
5. **Columns are undecoded.** Each non-zero row is one-hot, but the bit is *not* a function of the
   target connector alone: A Tip is the target at `byte0.bit2` in one preset and at `byte1.bit6` in
   another; Output Tip at `byte0.bit0` and `byte0.bit2`. The data are consistent with a fixed
   crosspoint table keyed by (source, target) — 8 of ~180 cells seen once each — which is far too
   little to decode and nothing to test against.

Consequences: Signal Loom shows the matrix **verbatim** with the row observation labelled
*hypothesis*, reports the routing as undecoded, and writes **no ML10X file**. The
`matrix-diff` helper exists so that controlled export pairs (change one loop, export again) accumulate
the evidence a decoder would need.

Also confirmed on the sample: 14 connectors with ids 0–9 = A Tip, A Ring, B Tip … E Ring and 10–13 =
Input Tip, Input Ring, Output Tip, Output Ring (the file's own names, "guitar" at 10 and "Output" at
12, agree); `tipT`/`ringT` = 127 ("Nothing") on every preset; `bypass` = 0 on every preset, so its bit
layout is unverified.

## 3. What the workspace does

1. **Load** an editor backup. The device is detected from `deviceModel`; anything else is kept as an
   opaque snapshot with its keys listed. The native summary shows dump type, date, size, hash check,
   byte-exactness, warnings (schema version, hash mismatch, slot counts) and the unknown-key count.
2. **Inspect (MC8).** Banks → preset grid (page 1 A–H, page 2 I–P, aux-only Q–V, expression presets)
   → message table with slot, status badge (known / third-party name / unknown), type, decoded summary
   (`CC#49 = 0 on ch 1`), action, toggle position, raw bytes and anomalies. Bank messages and
   controller settings (all-banks files) have their own panels; unknown data has its own tab.
3. **Compare (MC8).** Pick a rig and one of its MC8 banks; every switch is classified same / differs /
   controller only / Signal Loom only, with the named differences (short name, messages, order,
   unsupported native messages).
4. **Propose (MC8).** Edit names, flags and PC/CC messages; locked slots stay verbatim. *Review* shows
   the exact field diff, the self-check and what was preserved; only then is the single-bank file
   offered for download. A refused edit (range, type, locked slot, unknown key) produces no file.
5. **Inspect (ML10X).** Controller settings with evidence, 14 connectors with jack labels, bank/preset
   grid, preset detail (name, mode, spillover, raw bypass bitmap, MIDI recall) and the matrix table
   with the row observation. *Routing experiment* loads a second backup and lists the rows that moved.

## 4. Limitations (stated in the UI too)

- Fixture-validated only: no Signal Loom-written file has yet been loaded into the Morningstar editor
  or restored to an MC8. The proposal panel repeats this and tells the user to restore into an unused
  bank and inspect before saving to the controller.
- A successful structural round trip (byte-identical re-serialization, matching hash) establishes
  *format fidelity*, not compatibility with the official editor.
- Name-length caps are the maxima seen in real exports; the proposal warns, never truncates.
- Bank messages: which of the 16 slots fire On Enter vs On Exit is not established (all empty in the
  fixtures); they are shown raw.
- `general_configurations` values are shown with their key names; units and scales (e.g.
  `longPressTime`, `switchSensitivity`) are unverified.
- ML10X: routing undecoded; spillover connector codes other than 127 unverified; `bypass` bit layout
  unverified; `inputRingSwapPin` meaning unknown. No ML10X file is written.
- No hardware, firmware or SysEx interaction of any kind.

## 5. How to raise the evidence level

1. **MC8, editor-validated:** load a Signal Loom proposal (single bank, into an unused bank) in the
   editor and report whether it loads and what each switch shows. Share a bank backup of an *empty*
   bank to confirm empty-slot defaults, and one with a non-PC/CC message so the third-party type names
   can be checked against the editor's labels.
2. **ML10X:** export a Device Backup, change exactly one loop in one preset, export again, and load
   the pair in *Routing experiment*. Each pair adds one (source, target) cell to the crosspoint
   evidence. Export a preset with a non-default spillover target and a bypassed loop to pin `tipT`/
   `ringT` and `bypass`.
3. Never share device serials or private rig configurations in the public repository; the fixtures
   used here are public third-party files and are not vendored.

## 6. Test evidence

See the "Verification" section of `SESSION-7-PROGRESS.md` for the exact commands and counts.
