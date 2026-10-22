# Live MIDI — hardware validation checklist (Session 4, P0b)

A user-run procedure. The autonomous build sandbox performed **no hardware tests**; the owner
subsequently ran the real transport on Windows on **2026-10-18** and **2026-10-21**.
Results are recorded in the [first session](live-hardware-validation-2026-10-18.md)
and [second session](live-hardware-validation-2026-10-21.md). Core PC/CC and safety
tests passed; some checklist items remain **partially complete**. Every step records three things separately, and the
app's coverage table uses the same words:

| Word | Meaning |
|---|---|
| **documented** | a manufacturer page/manual says so (links in `docs/research.md` §8) |
| **simulation-tested** | the virtual transport delivered it in CI (`backend/tests/test_live_*.py`, `frontend/e2e/live.spec.ts`) |
| **hardware-verified** | *you* observed it on your pedals and wrote it down here (and, optionally, in the app via "verified hops") |

What the app will ask of you: before the first send over a route in each connection session, a
dialog lists that route's hardware prerequisites (MC8 Cross MIDI Thru, Omniport MIDI-out mode, the
Strymon MIDI EXP cable, ML10X DC power) and any unverified hop by name; nothing is queued until you
confirm them. Stop and Disarm wait for the one message already handed to the driver and cancel the
rest. While connected, the backend watches the ports every second and disarms by itself when a bound
port disappears, whether or not the Live tab is open. On Windows two identical devices share one
port name; the app tells them apart by position, and if the number of same-named ports changes it
holds the binding closed until you re-save it.

Rules that hold for the whole session: start disarmed; one message kind at a time; safe volume or
the amp on standby; write down how to restore every preset you touch *before* you touch it; never
send anything to the MC8 or ML10X that writes memory (Signal Loom cannot, but the Morningstar
editor can — keep it closed while Signal Loom owns the ports).

## Status after 2026-10-21

| Step | State | Evidence and exceptions |
|---|---|---|
| 0 | **Partial** | Real MIDI and workstation bindings worked; version/firmware inventory remains |
| 1 | **Pass for input monitoring** | Multiple PC messages observed independently; complete DIN/Omniport-only echo audit not run |
| 2 | **Open as specified** | Own-USB-pedal PC+documented CC pair not done; **Sunset Omniport** CC 10/15 both values verified separately |
| 3 | **Pass for ML10X direct USB PC** | External power, CC0/PC0 and physical recall demonstrated |
| 4 | **Pass for tested DIN PC routes** | MC8 → ML10X → Volante → Collider; no all-kinds/ports generalization |
| 5 | **Pass for Omniport PC plus Sunset CC** | Four Omniports PC0/PC1; Sunset A/B CC 0/127; remaining three pedals' bypass CC not tried |
| 6 | **Pass for full-rig scene** | Eight messages/seven devices (Oct 18); PC+CC scene capture, recall, edit and persistence (Oct 21) |
| 7 | **Pass for positive follower subset match** | MC8 switch generated four PCs; two matched follower scene (2/2); full echo coverage remains |
| 8 | **Partial optional** | Morningstar Editor release/reacquire read-only pass; hub/isolator/noise not tried |
| Safety extensions | **Pass in observed scenarios** | Stop, Disarm, idle hot-unplug, active queued unplug/error, auto-rebind staying disarmed, clean backend restart disarmed |

**Read [2026-10-21 hardware test report](live-hardware-validation-2026-10-21.md) for exact
messages, physical observations, and remaining acceptance items.**

## Status after 2026-10-18

| Step | Status | Evidence / gap |
|---|---|---|
| 0 | **Partial** | Real MIDI ports opened; firmware, OS and backend versions unrecorded |
| 1 | **Pass for monitoring** | MC8 USB input showed independently generated multi-channel PC traffic; echo completeness not established |
| 2 | **Open** | Direct pedal PC plus documented bypass CC pair not completed |
| 3 | **Pass for ML10X USB PC** | CC 0/PC 0 sent, preset recalled; cross-bank selection not isolated |
| 4 | **Pass for tested PC paths** | MC8 DIN → ML10X Thru → Volante Out/Thru → Collider, using the real board's topology |
| 5 | **Pass for PC 0 and PC 1** | All four Omniport-connected pedals responded; bypass CCs still open |
| 6 | **Pass for full-rig PC audition** | Eight messages, seven devices, default 20 ms delay; MC8 bank mapping is planner-only |
| 7 | **Partial** | Physical footswitch traffic observed; exact matching-scene follower/echo audit open |
| 8 | **Not tried (optional)** | Hub, isolator, noise, simultaneous editor access |

## 0. Setup on the Windows workstation

1. `cd backend && .venv\Scripts\pip install -e ".[live]"` (installs `python-rtmidi`; a wheel exists
   for Windows). Start the backend as usual; it binds 127.0.0.1 only.
2. Open the rig → **Live** tab. Transport: switch to **Real MIDI ports**. If it is greyed out, the
   reason is printed (library missing). *Do not* use the virtual mode for anything below.
3. Close the Morningstar editor, Nixie 2 and Neuro. On Windows a class-compliant USB MIDI port is
   owned by one program at a time; if a port shows **owned by another app**, close the other
   program or use **release** / **reacquire** here.
4. Record (template at the end): OS build, backend version (`/api/health`), MC8 firmware, ML10X
   firmware, Strymon firmware(s), and the exact port names the Live tab enumerates.

## 1. Monitor only — all sending disarmed

- [x] Bind the MC8 USB **input** (device → computer) only. Connect. Stay disarmed (initial listening test).
- [x] Press footswitches on the MC8 in a bank whose presets send PC/CC to your pedals.
- [x] Record whether anything appears under *Observed on inputs*. PC messages on channels 1, 10, 12 and 13 were observed; this **does not establish complete echoing**. Documented: the MC8 sends to USB
  whatever its presets address "USB" or "all ports"; whether footswitch traffic for DIN/Omniport-only
  messages is echoed to USB is **not documented** (evidence: unknown). Write what you see.
- [x] Inspect the fixed cabling against the Wiring tab: the actual chain and four Omniports were confirmed; see the dated report.

Result template: `1. monitor: observed = yes/no; messages seen: …; MC8 setting "MIDI Thru"/port routing: …`

## 2. One physical PC and one safe CC on one real pedal (direct, confirmed endpoint)

Pick the pedal with the best-documented direct USB MIDI: **Volante** (Nixie 2 lists it) or **BigSky
MX** / **ML10X** (both document USB MIDI). **Not** the Sunset over USB (firmware only). **Not** the
Zelzah unless its own manual documents USB MIDI control for your unit.

- [ ] Note the pedal's current preset number and how to recall it again (front panel).
- [ ] Bind the pedal's own USB endpoint (computer → device). Connect. Dry run a scene that
  contains only that pedal; read the bytes.
- [ ] Arm (type the phrase). In the pedal's panel: **Send PC** for a preset you know. Observe the
  display. Disarm.
- [ ] Record: PC number sent (wire, zero-based) → preset shown on the device (one-based or not).
  This settles `display_numbering` for the profile.
- [ ] Arm. Send the documented bypass CC with its *engage* value, then *bypass*. Observe the LED /
  relay. Disarm. Record whether both values behave as documented (and whether "0 = bypass,
  1–127 = engage" or an exact 127 is needed).
- [ ] Restore the original preset by hand. Record how.

If the pedal does nothing: check channel (instance channel vs the pedal's own setting), whether the
port is actually the pedal (not the hub), and whether the pedal needs "MIDI in: USB" enabled.

## 3. ML10X receives a PC while externally powered

- [x] ML10X powered from its DC inlet (USB alone does not switch the relays).
- [x] Bind the ML10X USB endpoint. Dry run a scene with only `ML10X preset n`: bytes `B9 00 00` then `C9 00`, and physical preset recall worked.
- [x] Arm and audition; observe Bank 1, Program 3 → Program 0.
  Subsequent **DIN-over-MC8 cross-bank** test 2026-10-21: preset 128
  (`B9 00 01` then `C9 00`) recalled Bank 2, Program 0 ('Empty'),
  then CC0=0/PC0 returned to Bank 1, Program 0 with display and audio confirmation.
  This cross-bank test used MC8 DIN, **not** the ML10X's own USB endpoint.
- [ ] Keep this result separate from anything about the ML10X **Thru** jack: the Thru is a copy of
  the 5-pin **In**; it is *not documented* to repeat USB traffic (the coverage table says
  "unverified" for pedals behind the Thru when the ML10X is reached over USB).

## 4. MC8 Cross MIDI Thru chain, one hop at a time

**Actual owner-rig reference, verified for tested PC commands:** computer USB → MC8 → DIN Out
→ ML10X In → ML10X Thru → Volante In → Volante MIDI Out (forwarding) → Collider In.
Separately: MC8 Omniport 1 → Sunset, 2 → Zelzah, 3 → Hedra, 4 → MOOD MKII. There
is no return cable and no Meris MIDI I/O or Enzo in this tested MIDI route. See the
[dated record](live-hardware-validation-2026-10-18.md).

Prerequisites (documented, must be set on the hardware): MC8 **Cross MIDI Thru** on (USB in →
MIDI Out / Omniports); every pedal on a distinct channel unless you *declared* a shared channel in
the Live tab's bindings.

- [x] Hop 1 — MC8 USB → DIN → ML10X: unbind ML10X's own USB; CC 0/PC via MC8;
  hardware responded. A separate USB-only ML10X test was also completed.
- [x] Hop 2 — ML10X physical Thru → Volante: PC 0 on channel 1 via MC8; preset
  responded.
- [x] Hop 3 — Volante MIDI Out (configured/working as forwarding) → Collider:
  modeled cable already present; Volante profile's MIDI Out role changed to `thru`
  to expose the path. PC on channel 3 recalled a Collider preset.
- [ ] Further device-specific CC, Clock or SysEx behavior on these hops remains untested.
  The earlier proposed Meris MIDI I/O / Enzo chain was **not** the rig tested.
- [ ] For each hop that worked, you may mark it hardware-verified in the Live tab (bindings →
  verified hops; stored on this computer only). Do not mark hops you did not observe.

Note: the virtual demo rig models ML10X → BigSky MX over the Thru. The owner's
imported/custom pedals do **not** imply manufacturer-verified profiles. Keep missing
CC maps unknown rather than inventing them; preserve user-verified PC test evidence.

## 5. MC8 Omniports → TRS MIDI pedals (four outputs on this rig)

- [ ] Omniport n set to **MIDI Out** (Standard = tip active, or Type B) matching the cable; the
  pedal's TRS MIDI type per its manual (Sunset: Strymon MIDI EXP cable or Conduit, EXP jack in MIDI
  mode, firmware 1.20+).
- [x] PC test: all four used Omniports recalled **PC 0 then PC 1** in two scene auditions
  (Sunset ch 12, Zelzah ch 7, Hedra ch 5, MOOD MKII ch 4); physical responses confirmed.
- [x] Sunset Side A CC 10 and Side B CC 15: both `0` bypass and `127`
  engage physically confirmed by LED and guitar audio on 2026-10-21.
- [ ] Other Omniport pedal bypass/engage CCs still untested.
  All four Omniports are occupied by MIDI on this rig; none is reserved for expression.
- [ ] Do not try SysEx: Omniports cannot carry it and have no return path (documented).

## 6. Audition one real scene

- [x] Dry run the `Full Rig Test`: eight intended messages, all through MC8 USB output.
- [x] Arm and audition with the default delay (20 ms); the eight messages logged `SENT`.
- [x] Compare physical response with intended messages: owner reported all seven devices
  responding as intended. The scene's MC8 `Bank 1 · G` assignment does **not**
  transmit an MC8 bank-change message. Restore status and safe-volume detail were not recorded.
  A scene audition proves that *messages were sent*; the pedals' displays are your evidence of
  arrival.

## 7. MC8 footswitch traffic

- [x] With MC8 USB input bound and listening, press several existing MC8 footswitches.
  Multiple PC messages appeared and the follower showed *ambiguous* partial matches to
  the **unrelated** Signal Loom scenes (e.g. 1/2 and 1/4).
- [x] Program a scene matching two **observed** messages of one physical
  switch and check `possible active scene`: `MC8 Follower Test` matched 2/2.
  Note: this was a subset of the four-PC footswitch burst, not an exact
  four-message scene. The other `ML10X Hardware Test` was a partial 1/2 match.
- [ ] Determine whether **every** DIN/Omniport-only MC8 message is echoed to USB:
  observed multi-channel traffic is not a complete per-port echo audit.

## 8. Optional: powered hub, isolator, noise

- [ ] Hub: one upstream cable; MC8, ML10X, Volante (and other **documented** direct USB MIDI
  pedals) on separate ports. Repeat step 2 for each. Record enumeration order/names (Windows may
  rename duplicate ports "… 2").
- [ ] Isolator: only after the hub works without it; record whether every device still enumerates.
- [ ] Noise: note any hum/whine with the computer attached vs detached.
- [x] Morningstar Editor (read-only handoff): disarm/release MC8 ports, let editor read MC8,
  disconnect/close editor, reacquire ports in Signal Loom, observe messages. No write operation tested.
- [ ] Nixie / Neuro: whether they can open a port while Signal Loom has it is
  **not promised**; release/reacquire would need separate testing.

## Record template

```
Date / OS / backend version / python-rtmidi version:
Firmware: MC8 … | ML10X … | Volante … | Zelzah … | Sunset … | Collider … | Hedra … | Enzo …
Ports enumerated (exact names):
Step | Endpoint | Route (hops) | Message (bytes) | Channel | Observed on the pedal | Restore done? | Verdict (hardware-verified / failed / not tried)
```

Send the filled record back; the shipped profiles and vendor tables will be updated from it, with
`evidence = user` and your note as the citation.
