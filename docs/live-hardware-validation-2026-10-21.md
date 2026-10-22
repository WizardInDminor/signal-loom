# Live MIDI hardware validation — 2026-10-21 (owner-run, follow-up)

**Rig:** Test Board · **Session:** Session 4 / P0b, second hands-on round ·
**System:** Windows, real MIDI ports · **Prior report:** [2026-10-18](live-hardware-validation-2026-10-18.md).

This is a record of the owner's observed live-hardware tests and supplied screenshots during a
guided session. It does not assert tests were run by CI or the autonomous coding agent. The
physical MIDI topology remains the one recorded in the October 18 report: MC8 USB as the
computer interface, MC8 DIN → ML10X → Volante → Collider, plus the four MC8 Omniports to
Sunset, Zelzah, Hedra and MOOD MKII.

## Test results

| Area | Test / action | Observed results | Verdict and scope |
|---|---|---|---|
| Sunset CC A | CC 10=0 (bypass), CC 10=127 (engage), channel 12 | Signal Loom log showed SENT; owner verified LED/state and guitar audio for both directions | **Hardware-verified**, deterministic A-side bypass/engage on this pedal |
| Sunset CC B | CC 15=0 (bypass), CC 15=127 (engage), channel 12 | Log, visual and audio confirmation for both directions | **Hardware-verified**, deterministic B-side bypass/engage |
| Last sent → capture | After PC 1 and CC tests, selected **Sunset CC Capture Test** | Capture preview correctly offered PC 1, `state: engaged` (A-side CC 10=127) and independent CC 15=0 (B side) | **Pass** for capturing last *sent* commands, **not** reading pedal state |
| Captured scene recall | Dry run `CB 01`, `BB 0A 7F`, `BB 0F 00`; then audition at 20 ms | 3/3 SENT; owner confirmed preset and pedal response, A engaged/B bypassed | **Pass**, PC precedes CC commands |
| Scene edit and re-audition | Changed B-side CC 15 to 127; second dry run `CB 01`, `BB 0A 7F`, `BB 0F 7F` | 3/3 SENT; owner confirmed both sides now engaged | **Pass**, editable captured intent |
| Scene autosave / reload | Browser refresh after captured scene was saved automatically | Scene persisted PC 1, A engaged, B CC 15=127; compiler retained three messages | **Pass** for storage across refresh; UI showed `Saved` (autosave), without manual Save button |
| Idle USB unplug/replug | Armed, no queued messages; physically unplugged MC8 USB and reconnected | Automatically disarmed on port loss; bindings reopened after reconnect; stayed disarmed | **Pass**, idle hot-unplug safety |
| Stop during queue | 4-PC Omniport scene, 2000 ms delay; Stop after first two sent | SENT 1/4 Sunset, SENT 2/4 Zelzah; CANCELLED 3/4 MOOD, 4/4 Hedra; STOPPED: 2 queued cancelled | **Pass** for stopping pending messages; Stop does not itself disarm |
| Disarm during queue | Same 4-PC scene/delay; Disarm after first send | SENT 1/4 Sunset; CANCELLED 2/4 Zelzah, 3/4 MOOD, 4/4 Hedra; DISARMED: 3 queued dropped; button disabled | **Pass**, confirmed on app and pedalboard |
| Active USB disconnect | Same 4-PC scene/delay; MC8 USB removed after first send | SENT 1/4 Sunset; FAILED PC 1 ch 7 → Zelzah (WinMM `MidiOutWinMM::sendMessage` error); CANCELLED 3/4 MOOD and 4/4 Hedra; automatically DISARMED; bindings returned upon USB reconnect, still disarmed | **Pass**, transport-error fail-closed on an active real queue |
| MC8 observation | Pressed existing MC8 switch with older channel assignments, while Signal Loom listened | Four incoming PCs on `Morningstar MC8 0`: PC 0 ch 10; PC 5 ch 13; PC 5 ch 12; PC 1 ch 1 | **Pass** for multi-message observation, not proof that all possible port traffic echoes |
| Follower positive match | Built a no-transmit `MC8 Follower Test` scene from Sunset PC 5 ch 12 and Volante PC 1 ch 1, then pressed same physical MC8 switch | Follower reported **possible active scene** for `MC8 Follower Test` 2/2, plus **partial** `ML10X Hardware Test` 1/2; four total PCs still observed | **Pass** for complete *subset* match; not an exact four-message scene, footswitch identity or pedal-state verification |
| ML10X cross-bank recall | Added *model-only* preset 128 (Bank 2, PC 0), dry run `B9 00 01` then `C9 00`; sent over MC8 USB, then returned to Bank 1 program 0 using `B9 00 00` / `C9 00` | Physical display confirmed **Bank 2 Program 0 ("Empty")**, then **Bank 1 Program 0**; guitar audio and UI confirmed intended changes | **Hardware-verified** for CC0 bank select both directions with PC0 recall; no device memory write |
| External editor handoff | Disarmed and released MC8 input/output endpoints in Signal Loom; opened Morningstar Editor to read MC8; closed editor; reacquired in Signal Loom | Editor recognized hardware and read information; Signal Loom reopened ports and received new footswitch messages | **Pass** for release/reacquire/read-only editor handoff; no write test |
| Backend restart | From armed but idle, cleanly stopped/restarted backend process; returned to Signal Loom | User had to reconnect rig and reselect **Real MIDI ports**. After selection/reconnect, saved MC8 port bindings reopened, while system remained **disarmed** | **Pass** for clean-process-restart safety; not a crash-in-flight test |

## Important boundaries and product observations

- The follower's `possible active scene` is a **subset** match: two expected scene PC
  messages were seen within a four-PC burst. A different pre-existing scene showed
  1/2 partial. The controller's channel-13 command was observed, but is not mapped
  to the current modeled rig. This is correct conservative behavior for P2; longer-term
  exact-match vs subset-match diagnostics would improve state awareness.
- The saved MC8 bindings were preserved across backend restart, but **transport mode was
  not restored to Real MIDI ports** on restart. This was not unsafe (system stayed
  disarmed); consider improving mode persistence or explicitly signaling that manual
  re-selection is required.
- Scene edits autosave with the UI's `Saved` indicator; the backend-held **armed**
  state can remain active across a *browser refresh* (seen in a screenshot).
  A backend restart, in contrast, starts disarmed. UX should make this distinction
  explicit for safety.
- The send log used the workstation's then-current `Morningstar MC8 1` output
  endpoint; earlier sessions showed `Morningstar MC8 2`. The connector ordinal/name
  is environment-specific; route validation should use actual direction and bound
  device, not hard-code a particular display name.
- The implementation has a workstation-local `verified_hops` data structure, but
  the present Live UI does **not** expose a user-friendly way to mark each observed
  hop. Our written evidence is not automatically imported into coverage/profiles.
  Provide UI for exact device/hop/message kind, evidence provenance, date, and
  verification scope; avoid promoting unrelated PC/CC/Clock/SysEx claims.
- The Sunset profile includes CC 100 expression marked unverified. **No expression
  control or arbitrary knob CC was tested**; the proven values are CC 10/15 at
  0 and 127. Other Omniport pedals had PC recalls tested previously, but their
  bypass CC behavior remains untested.
- The clean backend stop/restart proved **disarmed recovery**, not behavior during
  an abrupt process crash while an in-flight MIDI message was at the driver.

## Remaining checklist and closeout decisions

1. **Direct-pedal USB PC/CC:** Original checklist step 2 calls for PC **and**
   documented CC using one pedal's *own* direct USB endpoint. This was not completed.
   Direct ML10X USB PC was verified in step 3, and Sunset CC 10/15 over MC8
   Omniport was verified, but these are not a combined direct-pedal USB PC+CC test.
2. **MC8 USB echo completeness:** Four PCs from an independently programmed footswitch
   were observed, but no byte-for-byte comparison to its complete MC8 outgoing
   configuration on each DIN/Omniport-only route was recorded.
3. **Hardware evidence UI:** `verified_hops` exists at the data layer but is not
   yet exposed as an owner-driven verification workflow. Can be a product follow-up;
   document the individual test evidence now.
4. **Optional integration:** Powered hub / isolator / analog noise comparison were
   not run; no Nixie/Neuro coexistence test was performed. Morningstar Editor
   release/reacquire **was** completed. No editor write test was attempted.
5. **Inventory & acceptance:** OS build, firmware versions, rtMIDI version and all
   preset-restore details were not captured. Re-run automated CI/review for the
   final branch head before merging PR #4. No performance load/jitter measurement,
   SysEx, or MIDI Clock validation is claimed.

**Assessment:** Core live PC/CC transport, coordinated scenes, capture/persistence,
follower positive-match behavior and failure-safety mechanisms have been observed
working on the owner's real board. The remaining items should be explicitly
accepted/deferred or validated before declaring the whole original checklist complete.
