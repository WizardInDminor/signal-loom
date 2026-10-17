# Live MIDI — hardware validation checklist (Session 4, P0b)

A user-run procedure. Nothing in this file has been performed by the autonomous session: the build
sandbox has no MIDI hardware and `python-rtmidi` could not even be installed there. Every step
below records three things separately, and the app's coverage table uses the same words:

| Word | Meaning |
|---|---|
| **documented** | a manufacturer page/manual says so (links in `docs/research.md` §8) |
| **simulation-tested** | the virtual transport delivered it in CI (`backend/tests/test_live_*.py`, `frontend/e2e/live.spec.ts`) |
| **hardware-verified** | *you* observed it on your pedals and wrote it down here (and, optionally, in the app via "verified hops") |

Rules that hold for the whole session: start disarmed; one message kind at a time; safe volume or
the amp on standby; write down how to restore every preset you touch *before* you touch it; never
send anything to the MC8 or ML10X that writes memory (Signal Loom cannot, but the Morningstar
editor can — keep it closed while Signal Loom owns the ports).

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

- [ ] Bind the MC8 USB **input** (device → computer) only. Connect. Stay disarmed.
- [ ] Press footswitches on the MC8 in a bank whose presets send PC/CC to your pedals.
- [ ] Record whether anything appears under *Observed on inputs*. Documented: the MC8 sends to USB
  whatever its presets address "USB" or "all ports"; whether footswitch traffic for DIN/Omniport-only
  messages is echoed to USB is **not documented** (evidence: unknown). Write what you see.
- [ ] Inspect the fixed cabling against the Wiring tab and note any difference.

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

- [ ] ML10X powered from its DC inlet (USB alone does not switch the relays).
- [ ] Bind the ML10X USB endpoint. Dry run a scene with only `ML10X preset n`: bytes are `CC 0 =
  bank`, then `PC n`.
- [ ] Arm, audition, disarm. Record the preset the ML10X displays and whether the bank CC was needed.
- [ ] Keep this result separate from anything about the ML10X **Thru** jack: the Thru is a copy of
  the 5-pin **In**; it is *not documented* to repeat USB traffic (the coverage table says
  "unverified" for pedals behind the Thru when the ML10X is reached over USB).

## 4. MC8 Cross MIDI Thru chain, one hop at a time

Reference configuration 1: computer USB → MC8 → **DIN Out** → ML10X In → ML10X Thru → Collider
In → Collider Thru → Meris MIDI I/O → Hedra / Enzo.

Prerequisites (documented, must be set on the hardware): MC8 **Cross MIDI Thru** on (USB in →
MIDI Out / Omniports); every pedal on a distinct channel unless you *declared* a shared channel in
the Live tab's bindings.

- [ ] Hop 1 — MC8 USB → DIN → ML10X: bind the MC8 USB output, unbind the ML10X's own USB. Dry run
  the ML10X-only scene: endpoint must read "MC8". Arm, audition, disarm. Record the ML10X display.
- [ ] Hop 2 — … → ML10X Thru → next device (Collider / BigSky MX): add that device's PC to the
  scene. Audition. Record. (If the next device's MIDI OUT is a *settable* Thru, like the BigSky
  MX, note the setting you used.)
- [ ] Hop 3 — Collider Thru → Meris MIDI I/O → Hedra: Meris TRS wiring and channel per the Meris
  I/O manual; record the I/O's switch positions. Audition one PC. Record.
- [ ] Hop 4 — → Enzo, same.
- [ ] For each hop that worked, you may mark it hardware-verified in the Live tab (bindings →
  verified hops; stored on this computer only). Do not mark hops you did not observe.

Note: the virtual demo rig models ML10X → BigSky MX over the Thru; your board's Collider, Meris
MIDI I/O, Hedra and Enzo are not shipped profiles yet. Add them in the Device library (jacks: MIDI
In / Thru / Out as they physically are; channel) before step 4 so the coverage table can trace
them; leave CC maps empty rather than guessing.

## 5. MC8 Omniports → TRS MIDI Strymon pedals, separately

- [ ] Omniport n set to **MIDI Out** (Standard = tip active, or Type B) matching the cable; the
  pedal's TRS MIDI type per its manual (Sunset: Strymon MIDI EXP cable or Conduit, EXP jack in MIDI
  mode, firmware 1.20+).
- [ ] One pedal per Omniport, one PC, then one bypass CC. Record. Three Omniports used for MIDI
  leave one for an expression pedal.
- [ ] Do not try SysEx: Omniports cannot carry it and have no return path (documented).

## 6. Audition one real scene

- [ ] Dry run the scene; read every row; confirm every prerequisite listed in the coverage table.
- [ ] Amp at a safe volume. Arm. Audition with the default delay (20 ms). Disarm.
- [ ] Compare what each pedal shows with the intended messages. Record differences per pedal.
  A scene audition proves that *messages were sent*; the pedals' displays are your evidence of
  arrival.

## 7. MC8 footswitch traffic

- [ ] With the MC8 USB input bound and listening, press the switch that recalls the scene from
  step 6. Record what *Observed on inputs* shows and what the follower says ("possible" at best).
- [ ] Record whether the MC8 echoes DIN/Omniport messages to USB at all; the follower is only as
  good as that.

## 8. Optional: powered hub, isolator, noise

- [ ] Hub: one upstream cable; MC8, ML10X, Volante (and other **documented** direct USB MIDI
  pedals) on separate ports. Repeat step 2 for each. Record enumeration order/names (Windows may
  rename duplicate ports "… 2").
- [ ] Isolator: only after the hub works without it; record whether every device still enumerates.
- [ ] Noise: note any hum/whine with the computer attached vs detached.
- [ ] Nixie / Neuro: whether they can open a port while Signal Loom has it is **not promised**; use
  release/reacquire and record what happens.

## Record template

```
Date / OS / backend version / python-rtmidi version:
Firmware: MC8 … | ML10X … | Volante … | Zelzah … | Sunset … | Collider … | Hedra … | Enzo …
Ports enumerated (exact names):
Step | Endpoint | Route (hops) | Message (bytes) | Channel | Observed on the pedal | Restore done? | Verdict (hardware-verified / failed / not tried)
```

Send the filled record back; the shipped profiles and vendor tables will be updated from it, with
`evidence = user` and your note as the citation.
