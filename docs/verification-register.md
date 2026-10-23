# Signal Loom — Living Verification Register

**Established:** 2026-10-22 · **Scope:** all released software and owner-run hardware tests · **Current baseline:** [Session 5 PR #7](https://github.com/WizardInDminor/signal-loom/pull/7), merged into main at `5285d351`.

This page is the canonical, **maintained index** of what has and has not been verified. Actual observations belong in [dated hardware reports](live-hardware-validation-2026-10-21.md). A passing simulator or CI run never constitutes physical pedal verification. Do not infer CC/Clock/SysEx reachability from successful PC traffic. Add new test IDs for each new session/feature, link evidence and preserve failures.

**Status vocabulary:** `HW-PASS` = owner observed the actual device response; `SW-PASS` = software/virtual test only; `PARTIAL` = narrower evidence than the full claim; `OPEN` = pending; `BLOCKED` = prerequisite missing; `FAIL` = observed failure; `DEFERRED` = explicitly out of current scope.

## Session 4 hardware baseline — completed and outstanding

Evidence: [2026-10-18](live-hardware-validation-2026-10-18.md), [2026-10-21](live-hardware-validation-2026-10-21.md), and the [original checklist](live-hardware-validation.md).

| ID | Status | Verification and limitations |
|---|---|---|
| S4-H01 | **HW-PASS** | PC recall: MC8 USB → DIN → ML10X → Volante → Collider; four MC8 Omniports → Sunset, Zelzah, MOOD MKII, Hedra. **PC only**, not blanket MIDI protocol coverage |
| S4-H02 | **HW-PASS** | Coordinated eight-message scene audition, owner-observed response on seven devices; outbound logs aren't device readback |
| S4-H03 | **HW-PASS** | ML10X direct USB PC, and **separate** MC8 DIN-path Bank 1 ↔ 2 CC0/PC0 physically confirmed; no claim that ML10X Thru repeats USB data |
| S4-H04 | **HW-PASS** | Sunset CC10 Side A and CC15 Side B 0=bypass/127=engage, physical/audio confirmation. **Discrete toggles, not continuous modulation controls** |
| S4-H05 | **HW-PASS** | Capturing, editing, replaying and persisting last-sent PC/CC intentions; no actual pedal-state query |
| S4-H06 | **PARTIAL** | Four PCs observed from an MC8 switch; 2/2 follower **subset** match, not exact switch identification or full echo validation |
| S4-H07 | **HW-PASS** | Stop, Disarm, idle/active USB disconnect fail-closed, bindings restored without rearming, clean backend restart disarmed; abrupt crash-in-flight untested |
| S4-H08 | **HW-PASS** | Read-only Morningstar Editor handoff: release → editor reads MC8 → reacquire and observe |
| S4-H09 | **OPEN** | Pedal's **own USB endpoint** PC and documented CC in one direct-USB test |
| S4-H10 | **OPEN** | Byte-level MC8 DIN/Omniport USB-echo completeness |
| S4-H11 | **OPEN** | Documented CC behavior on Zelzah, Hedra, MOOD MKII, and non-PC messages along DIN chain |
| S4-H12 | **DEFERRED** | USB hub/isolator/noise, third-party editor coexistence, optional topology variants |
| S4-H13 | **OPEN** | Owner-editable per-hop/per-message hardware verification UI; complete OS/driver/firmware inventory |

**Physical topology last tested (not a current-state guarantee):** MC8 USB → ML10X DIN → Volante → Collider, plus Omniports 1 Sunset, 2 Zelzah, and 3/4 Hedra and MOOD MKII (the October 18 record lists Hedra on 3 and MOOD on 4; recheck before testing). A Meris MIDI I/O was available, but not in the tested signal chain. Verify actual routing/channels before new tests.

## Session 5 software baseline — merged, virtual tests only

Evidence: [SESSION-5-RESULTS](../SESSION-5-RESULTS.md), [PR #7](https://github.com/WizardInDminor/signal-loom/pull/7), [final CI run 43](https://github.com/WizardInDminor/signal-loom/actions/runs/39803197037), implementation head `4c434023`.

| ID | Status | Verification and limitations |
|---|---|---|
| S5-S01 | **SW-PASS** | Texture save/duplicate/export/import, independently scaled/inverted two-device macro, triangle tempo-related LFO |
| S5-S02 | **SW-PASS** | Zero-send preview; separate Connect/Arm/Start; virtual output bounded to 20 CC/s total, 10 CC/s per destination; dedup/coalescing |
| S5-S03 | **SW-PASS** | Fake-clock/failing-transport Stop/Disarm/lease/endpoint fault protections, start/refusal and collision checks |
| S5-S04 | **SW-PASS** | Safety-relevant configuration mutation guard, duplicate physical-address conflict rejection and race-proofed metadata paths |
| S5-S05 | **SW-PASS** | Final-head CI: **210 backend passed, 4 skipped**; Ruff, frontend and **47 Playwright** tests passed. Not real pedal evidence |
| S5-H01 | **OPEN** | Identify two **documented repeatable continuous CC** controls on two physically present pedals; collect semantics, ranges, channels, manuals, safe restore |
| S5-H02 | **OPEN** | First real Texture moves two real devices in independently authored directions with bounded macro/LFO, physical confirmation |
| S5-H03 | **OPEN** | Physical Stop and Disarm while continuous modulation runs; no future sends after acknowledgment |
| S5-H04 | **OPEN** | Controlling browser tab closed → backend's short lease expires and stream stops; confirm from backend/observer |
| S5-H05 | **OPEN** | MC8 USB loss during a safe stream stops/disarms; reconnect never restarts or rearms |
| S5-H06 | **OPEN** | Actual rig Texture save/reopen/preview generates **zero** MIDI until new explicit Arm/Start |
| S5-H07 | **OPEN** | Physical CC stepping, audio/visual response, practical message budget and latency at safe settings |
| S5-H08 | **OPEN** | Missing/released port, unsafe CC and unacknowledged routes refuse Start with zero output |
| S5-H09 | **DEFERRED** | External expression, MIDI Clock output, multi-source modulation, full movements/transitions, Experiment Lab, shared-loop audio |

**Next owner session:** Run [Session 5 physical acceptance](session-5-hardware-acceptance.md) in stages **H01 → H02 → H03 → H06**, and only then **H04/H05** fault scenarios. The exact physical pedal/control pair must be documented before a live sweep; Sunset CC10/15 are **not eligible**.

## Owner offline Instrument smoke test — 2026-10-22

**Evidence:** Owner-observed screenshots of the Test Board's Instrument view, taken with the pedalboard disconnected. Not a GitHub CI or physical-pedal test; no attached hardware.

| ID | Status | Owner observation and boundary |
|---|---|---|
| **S5-U01** | **SW-PASS** | Created named **Undertow** Texture on actual Test Board rig, musical intent, starting Scene `none`, Bloom base 50%, tempo 72 BPM, triangle LFO 8 beats / 10% depth; two opposing mappings: Volante CC12 40→70 and Collider CC3 95→65. Snapshot at LFO≈−0.85 showed Volante≈52 and Collider≈83 as intended |
| **S5-U02** | **SW-PASS** | Both real profile definitions updated from owner-attached official manual/guide: Volante Echo Level CC12 and Collider Delay A Mix CC3 showed `documented continuous` in Instrument, but each explicitly displayed **not hardware-verified** |
| **S5-U03** | **SW-PASS (UI observation)** | Instrument screen showed **PREVIEW — not connected, nothing is transmitted**, `state idle`, `ticks 0`, `handed 0`, `sender queue 0`; both live CC routes **unreachable**. The UI's no-send status matched the intended offline-only workflow; no independent wire trace was available |
| **S5-U04** | **SW-PASS — owner recovery** | Owner performed actual `Test Board.complete.signal-loom.json` import on a separate Windows Signal Loom instance and fresh SQLite database (2026-10-22). Initial import exposed seeded-builtin ID collisions for MC8 and Sunset; PR #10 fixed this and passed backend/frontend/E2E CI. On second fresh-data import, UI emitted **two expected remap notices** (`morningstar-mc8` and `strymon-sunset` were restored as separate `prof_…` entries, leaving seeded originals unchanged); owner screenshot confirms **all nine pedal photos displayed**, including MC8 and Sunset, and Test Board layout/cables. Prior owner screenshots showed Undertow, inverse documented CC mappings, 10 Scenes, disabled LFO and idle/offline preview after restore. Export itself was inspected for nine valid image blobs and two readable PDF blobs, and synthetic full-media import is covered by CI. **Owner did not explicitly open both restored PDFs in the second installation**; avoid describing that UI step as performed. Physical MIDI controls remain unverified |

**Related observed UX issues:** See `UX-ML10X-01` (preset number stepping/reordering), `UX-LIBRARY-01` (intermittent search filtering), `UX-MANUAL-01` and `UX-INSTRUMENT-01` in [Future Features](future-features.md). They are recorded for future work without changing this ongoing test.

### Real complete-backup recovery regression — 2026-10-22

Owner observed the following on the **second isolated Windows restore-test installation** using the unchanged Test Board complete backup:
- First fresh import of original PR #8 package had correctly restored image bytes but silently substituted seeded MC8/Sunset profiles; issue #9.
- With PR #10 merged into `main`, importing into another fresh SQLite store produced two explicit, expected non-destructive profile collision notices: `morningstar-mc8 → prof_a29fad70710b`, `strymon-sunset → prof_6d633a1ead27`.
- Screenshot after import showed **nine pedal photographs rendered** on the restored board, including MC8 and Sunset; all signal/layout connections remained visible.
- The emitted warnings are intentional notifications of profile remapping, not backup corruption. This establishes the owner's requested actual-data regression scenario; the synthetic CI test also covers manuals, CC definitions and instance-based references.
- Scope of evidence: restoration of PDF binaries is supported by bundle inspection and automated tests, but the owner did not screenshot opening the two PDFs in the new installation. Actual physical MIDI remains outside this offline recovery test.

## Session 6 software baseline — MIDI Knowledge Workbench (virtual tests only)

Evidence: [design and delivery note](midi-knowledge-workbench.md), branch `feature/midi-knowledge-workbench` (draft PR). No hardware was touched; nothing in this session transmits MIDI.

| ID | Status | Verification and limitations |
|---|---|---|
| S6-S01 | **SW-PASS** | Structured control knowledge on the documented CC map: behaviour kept in agreement with the legacy `continuous` flag, documented range, source citation (PDF page index), manufacturer-default vs user-configured mapping with factory number, explicit hardware status, review status; legacy profiles load unchanged (`tests/test_knowledge_workbench.py`) |
| S6-S02 | **SW-PASS** | Quick Reference notes on profiles (model) and placed instances (unit): steps, page references, provenance, pins, stable timestamps; round trip through save, restart, export and import |
| S6-S03 | **SW-PASS** | Safety: a `proposed` control is never eligible for modulation; toggle/trigger controls are refused as switches; a Texture range outside a documented range and a scene value outside it or on an unreviewed control are warnings only — bytes never change; editing a control never rewrites a saved Scene or Texture (`control-usage` impact report) |
| S6-S04 | **SW-PASS** | Project files: Session 6 keys omitted when default so older versions still open plain exports; cited PDFs bundled by *Export with manuals* / complete backup; fresh-database import restores controls, citations, notes and files |
| S6-S05 | **SW-PASS** | Browser journey (`frontend/e2e/workbench.spec.ts`): library → workbench, find the chart, three controls entered consecutively citing pages 2 and 3, hardware claim on one only, note with steps pinned, reload, proposals from page text stay *proposed* and are not offered, Scene picker applies a reviewed control with the exact bytes, export/import; phone layout keeps an open editor and the reading position across Editor/Reference; keyboard-resizable split; in-place upload with a refused non-PDF |
| S6-S06 | **SW-PASS** | Backend robustness: PDFium calls serialised behind one re-entrant lock after two concurrent page renders segfaulted the process during visual testing; `tests/test_pdf_concurrency.py` overlaps 24 renders, searches and proposal reads from 8 threads and proves single-thread entry with a fake PDFium |
| S6-S07 | **SW-PASS** | Review follow-ups: hardware status and remapping are profile-level and shown as such with the units sharing the profile; saving controls never infers a MIDI interface (explicit *Declare MIDI input…*, evidence `user`); `test_entering_controls_never_claims_a_midi_interface`, e2e "entering controls never claims a MIDI interface" |
| S6-H01 | **OPEN** | Owner: open the real Volante and Collider profiles in the workbench beside the attached manufacturer guides, confirm the existing Echo Level CC 12 / Delay A Mix CC 3 entries show *documented continuous · not verified on my pedal*, and record page citations |
| S6-H02 | **OPEN** | Owner: mark a control *verified on my pedal* only after an owner-observed response; the app never does this (F-Q08 still applies) |

## Product verification debt / future proof

| ID | Status | Future gate |
|---|---|---|
| F-Q01 | **OPEN** | App UI for provenance-aware verification by device, connection hop and MIDI message kind; do not treat one kind as validating another |
| F-Q02 | **OPEN** | Coalesce macro drags into useful undo history; inspect multi-tab edit conflict user experience |
| F-Q03 | **OPEN** | Profile optimistic revisions (full PUT remains last-write-wins); stale whole-rig editor save can overwrite a newer metadata-only rename |
| F-Q04 | **DEFERRED** | Isolated Experiment Lab: guarded preset randomization, safe audition/capture and honest best-effort restore |
| F-Q05 | **DEFERRED** | Multiple modulation sources, arbitration/summing, Movement/Transition/Composition and expressive controllers; require new safety tests |
| F-Q06 | **DEFERRED** | Hardware expression routing via actual controller/Meris MIDI I/O; don't assume a spare MC8 Omniport |
| F-Q07 | **DEFERRED** | Manufacturer editor write, SysEx, full MIDI Clock, sound-loop playback and program inventory readback |

| F-Q08 | **PARTIAL (SW-PASS)** | Session 6: native UI for source-cited control definitions (behaviour, range, page citation, default vs remapped, per-control hardware status, review state) and page-text proposals that require human review; documented controls are never marked hardware-verified by the app. Still open: owner-run physical verification of individual controls (S6-H01/H02) |
| F-Q09 | **DEFERRED** | Draft pedal presets and guarded vendor-specific hardware save; slot inventory, backup, overwrite approval, verified procedure and observed write evidence |

| F-Q10 | **OPEN** | `UX-ML10X-01`: direct typed ML10X preset numbers, commit-once move, explicit collision handling, stable assignments and regressions |
| F-Q11 | **SW-PASS** | `UX-LIBRARY-01`: root cause was a response race (every keystroke listed the catalog and the page kept whichever answer landed last; the unfiltered answer is the slowest). Fixed by sequence-guarded, abortable, debounced listing (`useCatalogSearch`), filters carried in the URL, explicit loading / searching / zero-result / clear states. Reproduced deterministically and guarded by `frontend/e2e/library-search.spec.ts` (rapid typing with out-of-order answers, delete/retype, profile selection, Edit→Cancel/Save, reload, Back from the Workbench, zero results, category + query). Screenshots: `docs/screenshots/session-7/library-search-*.png`. Owner confirmation on the real imported catalog still welcome |
| F-Q12 | **DEFERRED** | `UX-INSTRUMENT-01`: category suggestions and multiple pedal functions for richer whole-rig view; keep assignments user-correctable |

| F-Q14 | **OPEN — verification debt** | Intermittent e2e failure on `main`: CI run [39896413361](https://github.com/WizardInDminor/signal-loom/actions/runs/39896413361) (docs-only commit `5502911`, job `e2e`), `frontend/e2e/jacks.spec.ts:77` "jack mapping: imported pedal → … → save → wire on the Board → survives reload" failed at line 156: after the page showed *Saved*, `GET /api/rigs/{id}` returned 0 connections (1 expected). The same spec passed on the heads of PR #13 and PR #15 minutes before and after. Not investigated (recorded during Team A's A-02 review checkpoint, deliberately outside PR #15). Candidate causes to check, in order: the test's *Saved* match racing the debounced PUT of the cable edit (an earlier save already shows *Saved*); the store's single-writer queue dropping a revision when a PUT returns while a newer revision is queued; a Board-side cable commit that does not bump the revision. Follow-up assignment proposed: reproduce with a deterministic delay on `PUT /api/rigs/*` via `page.route`, then fix the test or the save path, never the assertion |
| F-Q13 | **SW-PASS — owner full-backup restore** | PR #8 added complete photo + PDF bundles; PR #10 fixed fresh-seed profile-ID collisions without modifying existing definitions. Real Windows owner recovery confirms all 9 pedal images visible after importing complete Test Board backup; two profile remap notices are intentional, not missing-file warnings. Export audited for 2 embedded PDFs; import/asset regression suite CI passed. Remaining optional confidence check: open each restored PDF in Device Library. No live hardware was tested |

## How to update this register

1. **Before work:** reference affected IDs in the next PR/charter; distinguish SW-PASS from pending real-hardware tests.
2. **At code merge:** add commit, CI evidence, exact scope and new OPEN hardware IDs for changes that transmit MIDI.
3. **At hands-on test:** create `docs/live-hardware-validation-YYYY-MM-DD.md` recording rig/firmware/OS, exact device + route + CC/channel/values, test steps, observed response, event log, restoration and pass/fail. Include screenshots or notes when useful. Then update only the proven statuses here and link the report.
4. **On failure:** keep status FAIL/PARTIAL and retain the observation even after a later correction; record the new dated retest separately.
5. **Before live performance:** recheck active Texture controls, port identities, MIDI channels, Stop/Disarm, power and noise after changes in gear, firmware, OS or wiring.

**Evidence categories must remain distinct:** manufacturer's documented mapping, user's safe-target declaration, simulated send, OS MIDI send completion, observed MIDI input, and human-observed physical pedal response are different facts.
