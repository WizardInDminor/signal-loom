# Session 5 — Owner's Real-Hardware Acceptance Procedure

**Status: NOT YET RUN on physical pedals.** This is a planned checklist, not evidence.  
**Traceability:** [Verification Register, S5-H01–H08](verification-register.md).  
**Baseline:** Session 5 / PR #7 merged into main on 2026-10-22. Prior observations in [October 21 hardware record](live-hardware-validation-2026-10-21.md).

**Goal:** confirm that one real Texture safely modulates **two documented continuously variable controls on two physically connected pedals** with independently scaled mappings, and that Stop, Disarm, the browser lease and USB failure safeguard the continuous stream.

## Non-negotiable preparation

Set amplifier and monitor levels safely low and keep Stop/Disarm within reach. Identify each affected pedal's **original preset/settings and how to restore them manually**; never assume Stop undoes an already sent CC. Use a local workstation and the existing backend-owned MIDI layer; phone access cannot bypass localhost restrictions. Do not leave a performing stream unattended.

**Do not use Sunset CC10/CC15 as sweep targets.** Only binary bypass/engage was hardware-verified for those. Avoid CC0/32, CC120–127, toggle/bypass, memory-write, reset and speculative raw CC mappings. No MIDI Clock or SysEx experiments in this procedure.

Actual October wiring (recheck first): computer USB → MC8; DIN → ML10X → Volante → Collider; MC8 Omniport 1 Sunset, 2 Zelzah, 3 MOOD MKII, 4 Hedra. The virtual BigSky MX/synthetic pedals used in tests **are not evidence of this owner's current hardware inventory**. Consult the manuals for the physically present Volante, Collider, Hedra, Zelzah or MOOD MKII as possible candidates; **none is pre-approved** for a specific continuous CC by this checklist.

## A. Document two safe targets — S5-H01

- [ ] Record actual rig date, git commit/build, computer OS, MIDI interface name/direction, MC8/ML10X and pedal firmware (where known).
- [ ] For **Pedal 1** and **Pedal 2**, record manufacturer/model, connection path, MIDI channel, official/manual page or URL, exact controller number, repeatable value semantics, safe bounds and a way to observe the change by sight or ear.
- [ ] Confirm the two targets are separate physical addresses in the current route; watch for device instances sharing a physical endpoint+channel+CC. Read the Instrument readiness explanations before arming.
- [ ] Save or note the original presets and parameter settings and the restore procedure. Have an easy way to shut off transmission.
- [ ] If a profile lacks verified continuous-CC metadata, a user declaration must accurately cite the known semantics; mark its evidence as **user-declared**, not manufacturer-/hardware-verified. If any target remains uncertain, mark H01 BLOCKED and **do not send**.

## B. Preview without sending — S5-H06 (first part)

- [ ] With the real rig loaded, select Instrument and create a **new** named test Texture (do not overwrite the synthetic Undertow fixture).
- [ ] Map one macro to both documented CCs with **modest independent safe ranges** (inside the manufacturer's permissible range). Invert one only if musically useful. Start LFO disabled/depth zero, slow tempo ~60–80 BPM, long 8–16 beat period.
- [ ] Preview macro 0, 0.5 and 1; write down expected resolved MIDI integer values at each. Change tempo, LFO depth and mapping values in preview. Confirm no sent-message counter increment and no physical change from preview/edit/save/open.
- [ ] Select **Real MIDI ports**, check MC8 endpoint is correct and open, and satisfy only legitimate route/hop acknowledgments. Stop if unexpected routes, busy/ambiguous ports or unsafe controls are reported.

## C. First controlled live transmission — S5-H02 and H07

- [ ] With Pedal 2 mapping temporarily disabled, **Connect**, explicitly **Arm**, then separately **Start performance** for the Texture. Start conservatively (shallow range, depth 0) and confirm Pedal 1 responds physically as intended. **Stop, Disarm and restore**.
- [ ] Enable both targets; re-preview; explicitly Arm/Start with slow/shallow triangle modulation (example depth 0.05–0.15). Watch both actual pedals. Record whether movement is in the authored directions, audible/visible stepping, any delays and any mismatch between intended/sent and observed state.
- [ ] Record MIDI event counts, planned/handed/deduplicated/deferred/failed status, sent channels and CC numbers, exact settings, and whether apparent changes are smooth, stepped or inaudible. The software's cap is **20 CC/s aggregate / 10 per physical destination per second**, not a guarantee of smooth audio.
- [ ] Treat SEND in the app without a physical reaction as unconfirmed, not HW-PASS.

## D. Normal safety and persistence — S5-H03/H06/H08

- [ ] While performing, press **Stop**. Confirm no additional send events after Stop acknowledges; previously sent values may remain physically set. Disarm/restore by hand.
- [ ] Start again deliberately, press **Disarm** while performing, and confirm output halts without automatic rearm.
- [ ] Save the authored Texture, refresh/close/reopen, confirm name/BPM/macro/mappings/LFO remain. Confirm no send occurs on navigation, opening, editing or previewing; rearming and pressing Start are explicitly necessary for any new performance.
- [ ] Perform **no-send refusal checks**: inspect readiness with released/missing endpoint, invalid/unsafe CC or unconfirmed hops and confirm Start is refused. Do not transmit any hazardous controller number.

## E. Failure and unattended-stream safeguards — S5-H04/H05

**Only after A–D behave predictably.** Keep volume safe and restore plans ready.

- [ ] Begin a slow, shallow stream. Close the **controlling browser tab**. Confirm via backend log or independent local observer that the stream stops after the short browser lease expires (nominally five seconds plus timing tolerance), and does not restart when a tab reconnects. A closed tab alone is not observation.
- [ ] Start a new bounded stream, then unplug MC8 USB while active. Inspect after reconnect: expected automatic Stop/Disarm, canceled/failed follow-up sends, bindings recovered if available, **no automatic Arm or Start**. Do not deliberately disconnect a speaker cable or high-current power connection.
- [ ] As an optional later retest, verify backend restart remains disarmed while a continuous stream had been active; Session 4 already physically verified **idle clean-restart safety**, not Session 5's exact continuous-stream case.
- [ ] Stop/Disarm and restore both pedals before leaving the workstation.

## Owner record to complete (copy into a dated test report)

| Field | Actual observation |
|---|---|
| Date, build/commit, OS, MIDI driver, firmware | |
| MC8 and downstream wiring; physical channel/port modes | |
| Pedal 1: model, CC, channel, endpoint/hops, manual citation, safe bounds | |
| Pedal 2: model, CC, channel, endpoint/hops, manual citation, safe bounds | |
| Starting presets/parameter values; recovery method | |
| Macro base, mappings, inversion, BPM, period, LFO depth | |
| Preview values at 0 / 0.5 / 1, and proof of zero sends | |
| Start: exact messages/observed pedal responses and counters | |
| Stop/Disarm observations and physical restoration | |
| Closed-tab lease expiry and observed stream shutdown | |
| Active-queue USB loss/reconnect/disarm observations | |
| Failures, deviations, screenshots/video, remaining unknowns | |

| Register ID | Verdict (PASS / PARTIAL / FAIL / BLOCKED / NOT RUN) | Observation and evidence |
|---|---|---|
| S5-H01 | NOT RUN | |
| S5-H02 | NOT RUN | |
| S5-H03 | NOT RUN | |
| S5-H04 | NOT RUN | |
| S5-H05 | NOT RUN | |
| S5-H06 | NOT RUN | |
| S5-H07 | NOT RUN | |
| S5-H08 | NOT RUN | |

**After testing:** write `docs/live-hardware-validation-YYYY-MM-DD.md` with these actual observations, update [verification-register.md](verification-register.md) only for proven behaviors, keep unexpected failures even if later resolved, and state whether physical Session 5 acceptance is complete or partial. Do not generalize one particular pedal's CC to all devices or routing types.
