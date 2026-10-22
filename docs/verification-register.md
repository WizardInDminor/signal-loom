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
| **S5-U04** | **PARTIAL** | Owner's 2026-10-22 `Test Board.with-documents.signal-loom.json` inspected: valid format-3 JSON; 11 rig device profiles, 10 Scenes, Undertow and 2 valid embedded, correctly referenced PDFs (Volante 25 pages, Collider 2). **Not a complete photo backup** (`assets: []` although profile images are referenced). Exported Undertow has `lfo.enabled: false` despite earlier UI screenshot showing it enabled; check intended saved state. Actual re-import/reopen restoration **not yet tested**. No physical MIDI evidence |

**Related observed UX issues:** See `UX-ML10X-01` (preset number stepping/reordering), `UX-LIBRARY-01` (intermittent search filtering), `UX-MANUAL-01` and `UX-INSTRUMENT-01` in [Future Features](future-features.md). They are recorded for future work without changing this ongoing test.

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

| F-Q08 | **DEFERRED** | Source-backed manufacturer MIDI-map ingestion, control semantics, user custom maps and per-control physical evidence; never mark documented controls as hardware-verified by default |
| F-Q09 | **DEFERRED** | Draft pedal presets and guarded vendor-specific hardware save; slot inventory, backup, overwrite approval, verified procedure and observed write evidence |

| F-Q10 | **OPEN** | `UX-ML10X-01`: direct typed ML10X preset numbers, commit-once move, explicit collision handling, stable assignments and regressions |
| F-Q11 | **OPEN** | `UX-LIBRARY-01`: Device Library search query sometimes shows unfiltered catalog; preserve query/async results, add browser regressions |
| F-Q12 | **DEFERRED** | `UX-INSTRUMENT-01`: category suggestions and multiple pedal functions for richer whole-rig view; keep assignments user-correctable |

| F-Q13 | **IN REVIEW** | PR for explicit complete backup with both photos and PDFs, all referenced media present or fail closed, fresh-database restore regression test and export UI; owner still to validate Test Board export/re-import after merge |

## How to update this register

1. **Before work:** reference affected IDs in the next PR/charter; distinguish SW-PASS from pending real-hardware tests.
2. **At code merge:** add commit, CI evidence, exact scope and new OPEN hardware IDs for changes that transmit MIDI.
3. **At hands-on test:** create `docs/live-hardware-validation-YYYY-MM-DD.md` recording rig/firmware/OS, exact device + route + CC/channel/values, test steps, observed response, event log, restoration and pass/fail. Include screenshots or notes when useful. Then update only the proven statuses here and link the report.
4. **On failure:** keep status FAIL/PARTIAL and retain the observation even after a later correction; record the new dated retest separately.
5. **Before live performance:** recheck active Texture controls, port identities, MIDI channels, Stop/Disarm, power and noise after changes in gear, firmware, OS or wiring.

**Evidence categories must remain distinct:** manufacturer's documented mapping, user's safe-target declaration, simulated send, OS MIDI send completion, observed MIDI input, and human-observed physical pedal response are different facts.
