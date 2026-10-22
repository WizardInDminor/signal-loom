# Live MIDI hardware validation — 2026-10-18 (owner-run)

**Rig:** Test Board · **System:** Windows workstation, real `python-rtmidi` transport
· **Session:** Session 4 / P0b · **Result:** core PC routing and full-rig audition **passed**;
the checklist is **partially complete**.

This is an owner-observed record from an interactive test session, supported by screenshots of
Signal Loom's Live/Wiring/Scenes views and the owner's reports of pedal behavior. It is **not**
a CI or simulation result, and it is not evidence of tests not performed. The Session 4 autonomous
build had no physical MIDI hardware; this record is the subsequent owner-run test.

## Actual rig and computer endpoints

```text
Windows / Signal Loom ──USB──> Morningstar MC8 (receive channel 2)
                                   │
                                   ├─ DIN Out → ML10X In (ch 10)
                                   │              └─ MIDI Thru → Volante In (ch 1)
                                   │                                 └─ MIDI Out → Collider In (ch 3)
                                   ├─ Omniport 1 → Sunset (ch 12)
                                   ├─ Omniport 2 → Zelzah (ch 7)
                                   ├─ Omniport 3 → Meris Hedra (ch 5)
                                   └─ Omniport 4 → Chase Bliss MOOD MKII (ch 4)
```

There is **no** return cable from Collider to MC8 MIDI In. The above is the user's actual
working configuration, not the earlier proposed example chain involving a Meris MIDI I/O and Enzo.

Observed Windows endpoints used:
- `Morningstar MC8 1` — device → computer, bound to MC8 USB for monitoring.
- `Morningstar MC8 2` — computer → device, bound to MC8 USB for downstream sending.
- `Morningstar ML10X revb 1` — computer → device, used for direct ML10X USB test.
- `Morningstar ML10X revb 0` — device → computer, enumerated but not used in these tests.

The MC8 also exposed additional numbered input/output ports (MIDIIN2–4 /
MIDIOUT2–4). Exact OS build, application/backend version, `python-rtmidi` version, and
hardware firmware versions were **not captured**; fill them in during a later session.

## Observed tests

| Checklist | Test / route | Observed result | Verdict / remaining boundary |
|---|---|---|---|
| 0 | Real transport, port enumeration and bindings | MC8 and ML10X endpoints enumerated and opened; real MIDI used, not virtual | **Pass** for transport setup; version/firmware record incomplete |
| 1 | MC8 USB input, disarmed listening | Incoming PC messages (e.g. PC 0/1/3 on ch 10) visible on `Morningstar MC8 1`; later footswitch presses yielded multiple PC messages on several channels | **Pass** for live input monitoring; not a complete echo audit |
| 2 | Direct pedal PC **and** documented bypass CC | No complete PC+CC pair on a direct pedal tested | **Open**; ML10X PC in step 3 is a different test |
| 3 | Direct USB → ML10X (external DC powered, ch 10) | Dry run and actual send `B9 00 00` (CC 0=0), `C9 00` (PC 0); owner saw change from bank 1/program 3 to program 0 | **Hardware-verified** for USB PC recall; bank selection across different banks **not** independently tested |
| 4 / hop 1 | USB → MC8 Cross MIDI Thru → DIN → ML10X | After removing the *binding* for direct ML10X USB, identical CC0/PC0 messages went via `Morningstar MC8 2`; ML10X reacted; subsequent PC recalls also worked | **Hardware-verified** for tested PC route; Cross MIDI Thru enabled |
| 4 / hop 2 | MC8 → ML10X physical Thru → Volante (ch 1) | `C0 00` (PC 0) sent via MC8 USB; owner observed Volante change preset as intended | **Hardware-verified** for PC 0, not all CC/clock/SysEx |
| 4 / hop 3 | MC8 → ML10X → Volante MIDI Out → Collider (ch 3) | Wiring connection already existed; setting Volante MIDI Out's modeled `role` to `"thru"` exposed route; owner sent PC and observed Collider preset change | **Hardware-verified** for tested PC forwarding/recall; software route still has generic *unverified* evidence |
| 5 | MC8 Omniports 1–4 → Sunset, Zelzah, Hedra, MOOD MKII | One scene recalled PC 0 on all four; second scene recalled PC 1 on all four; owner observed correct response each time | **Hardware-verified** for PC 0/1 on all four paths; bypass CC **not tested** |
| 6 | Full-rig audition via MC8 USB | Eight compiled PC/CC messages, default 20 ms delay, all sent and user-confirmed working on seven physical devices | **Pass** for coordinated PC scene; see exact sequence below |
| 7 | Physical MC8 footswitch monitoring / follower | Several existing physical MC8 presets generated multiple observed PC messages; follower showed *ambiguous* partial matches to unrelated Signal Loom test scenes | **Pass** for multi-message observation; **open** for full scene match / exhaustive echo behavior |
| 8 | Powered hub, isolation, noise, simultaneous editor access | Not performed | **Open (optional)** |

### Exact eight-message full-rig send

From the `Full Rig Test` dry run and the `SENT 1/8`…`SENT 8/8` log,
**all via `Morningstar MC8 2`** with a configured 20 ms inter-message delay:

| Order | Target (channel) | Bytes | Intent |
|---|---|---|---|
| 1 | ML10X (10) | `B9 00 00` | Bank 1 (CC 0=0) |
| 2 | ML10X (10) | `C9 02` | Recall physical preset 2 |
| 3 | Sunset (12) | `CB 00` | PC 0 |
| 4 | Volante (1) | `C0 00` | PC 0 |
| 5 | Collider (3) | `C2 00` | PC 0 |
| 6 | Zelzah (7) | `C6 00` | PC 0 |
| 7 | MOOD MKII (4) | `C3 00` | PC 0 |
| 8 | Hedra (5) | `C4 00` | PC 0 |

The owner reports that the targeted physical changes all worked as intended. The scene was
*assigned* in the planner to `MC8 Bank 1 · G`, but **no MC8 channel-2 bank-change message was
compiled or sent**. An MC8 switch assignment is a future controller/export mapping, not a live
bank jump. Record this as a UI/feature distinction, **not** a failed MIDI transmission.

## Route evidence and product findings

1. **Volante → Collider routing gap.** Physical MIDI OUT forwarding worked, but the
   generic route graph would not walk beyond Volante until its existing `MIDI Out` port
   was given `"role": "thru"` in the profile JSON. Current generic evidence appropriately
   remains *unverified*. Consider a per-instance, user-friendly MIDI OUT/THRU setting with a
   separately recorded verified state and vendor-specific prerequisites.
2. **JSON editor feedback.** Editing a profile initially produced `Profile JSON is not valid yet`
   with no line/column detail; fixing the syntax and applying on blur then saving worked.
   Improve validation diagnostics and make MIDI forwarding editable without raw JSON.
3. **Released port vs route selection.** With both MC8 and ML10X outputs bound, manually
   `release`-ing the ML10X port left the coverage/dry run preferring that direct route.
   Removing the **ML10X binding** selected MC8 as intended. Review whether live route
   resolution should exclude released/unopened endpoints and explain the difference between
   release and unbind.
4. **Profile evidence lags hardware observations.** The Volante, Collider, Zelzah, Hedra and
   MOOD MKII still show unknown/unverified program support; owner testing establishes
   specific PC commands on this board. Do not change evidence to *published* without a
   manufacturer source. Preserve user observations and avoid blanket claims about other MIDI kinds.
5. **MC8 controller mapping vs live control.** `Bank 1 · G` in the scene editor was picked
   arbitrarily and does not send an MC8 bank-selection command. The UI could make this clear.
6. **Follower is appropriately cautious.** Existing MC8 footswitch banks were *not*
   programmed to match the new Signal Loom scenes, so the monitor showed partial matches
   (e.g. 1/2 and 1/4) and *ambiguous*, not a claimed active scene. A channel-13 PC was also
   observed but no channel-13 pedal is modeled: inspect MC8 preset messages before interpreting.
7. **Real-port watch is visible, not fault-tested.** The Live header reported port watching
   every 1 s; unplug-triggered disarm, Stop mid-queue and driver-failure fail-closed behavior
   were **not physically tested** tonight.

The real route is not a proof of device-state readback: a `SENT` entry means driver handoff,
and physical response was confirmed separately by observation. No SysEx, firmware update or
intentional preset-memory write was part of these tests. Restoration of *every* device's
original preset and firmware/version inventory were not separately documented.

## Resume next session

- **CC behavior:** choose one documented deterministic bypass/engage CC; confirm both values
  on hardware. Then test **Pedal panel → Last sent → Capture to scene → save/reload → audition**.
- **MC8 follower:** inspect one real footswitch's programmed byte list, compare USB-observed
  messages with DIN/Omniport output and construct a matching Signal Loom scene; check for
  *possible* and ambiguous/overlapping matches without overstating certainty.
- **Failure safety:** test Stop/Disarm during a queued audition, automatic hot-unplug disarm,
  reattachment remaining disarmed, and port release/reacquire on real Windows hardware.
- **Bank switching:** optionally test ML10X CC 0 across **two distinct banks**; do not infer
  bank selection solely from tests within bank 1.
- **Optional:** hub/isolator enumeration, noise, and editor handoff; collect OS/backend/firmware
  versions, exact port inventory, and restore confirmation.

**Do not merge Session 4 on the basis of this report alone.** This captures real progress
and remaining P0b coverage; it does not close every checklist item.
