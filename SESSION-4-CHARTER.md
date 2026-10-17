# Signal Loom — Session 4: Live Rig Control

**Status:** Autonomous implementation charter — new live-MIDI development phase  
**Repository:** https://github.com/WizardInDminor/signal-loom  
**Required base:** The **completed Session 3 implementation**, including Stage, user-managed device images, jack mapping, top/underside mounting, power planning, user manuals, and MIDI command favorites. At charter preparation, this code was in draft PR #3 (`experiment/session-3-freestyle`).  
**Branch for this charter:** `session-4-live-control`, created from Session 3's current implementation.  
**PR policy:** Merge/review Session 3 **separately** before creating Session 4's implementation PR. Develop Session 4 on its own branch, targeting the updated `main`. Do not merge automatically.

> To the implementation agent: Read this charter, the current code, ARCHITECTURE.md, Session 1–3 charters/results, the device-manuals/MIDI-commands charter, and docs/research.md. Preserve the existing tested planner and local user data. Execute incrementally, test, and report what works. Never treat a simulated route or message as verified behavior on the owner's physical pedals.

## Mission

Signal Loom has become a useful local-first physical rig designer and MIDI scene **planner**. Session 4 adds an **optional, explicitly armed live-control layer** so a guitarist can discover connected devices, audition planned PC/CC messages, dial in controls, and deliberately capture the resulting *intended* values back into saved scenes.

### Core rule: Wire once, reach everything

A guitarist should cable the computer to the board **once**, then be able to choose among all physically reachable pedals without swapping USB cables every time. This can mean one USB cable to the MC8, or one USB uplink to a powered hub. Support mixed arrangements.

**This is not a claim that all device protocols traverse all routes.** Show separate route coverage for PC, CC, clock and optional read-only SysEx, with evidence and reasons where unsupported or unverified. A physical single-cable uplink does not guarantee that vendor-specific software can share the app's open MIDI port.

**The MC8 must remain usable without a computer.** Live Signal Loom augments standalone, gig-ready foot control; it does not replace it. A compiled plan describes intended messages; sending those messages does not verify actual pedal state.

## 0. Safety boundary — required, not optional

- **Disarmed by default:** Every backend start, disconnection, lost binding, or transport reset disarms output. Arming requires a clear user gesture and prominent UI indication; never arm automatically, including after reconnect.
- **Allowed live output:** Documented/explicitly user-authorized PC and CC to confirmed MIDI endpoints while armed. Optional MIDI Clock only as a late P3 extension. No sending anything automatically on load, scene selection, device switching, or editing.
- **Forbidden:** Writing controller/pedal memory, upload/store SysEx, factory reset, firmware updates, MIDI editor-control protocols, auto-writing to the MC8 or ML10X, any device-side destructive action.
- **SysEx:** No SysEx in P0–P2. P3 may research specifically documented, evidenced *read-only* identity/query messages after a per-device explicit opt-in; unsupported or ambiguous requests must not be sent.
- **No-output dry run:** Dry run never calls a transport send method. Prove this with tests. UI must clearly distinguish dry-run messages, sent messages and actually received messages.
- **Stop and disconnect:** A visible Stop cancels queued messages immediately, without claiming to undo messages already transmitted; disconnect disarms and drops the queue.
- **Non-deterministic commands:** Toggle-type values and ambiguous effects require explicit warning/confirmation before actual sending. Never present last-sent state as measured state.
- **Local only:** Backend controls MIDI exclusively within Signal Loom, listens on localhost, and does not expose MIDI control to remote clients or another browser over the network.
- **Port access contention:** Another application (e.g. an official pedal editor) may exclusively own a USB MIDI endpoint. Explain the conflict and allow an intentional software release/reacquire; do not promise two programs always keep a port open concurrently.

## 1. Reconnaissance and continuity

1. Confirm that Session 3's full feature branch is the base, and it is merged into `main` before opening Session 4's implementation PR. The old `session-3-charter` branch is based on Session 2 and must **not** be used as the code base.
2. Read Session 1–3 records and the actual implementation: compiler, MIDI reachability, Morningstar adapters, scene editor, Stage, device profiles, command favorites, document storage, rig migrations, and save/revision logic.
3. Run backend tests, frontend lint/typecheck/build, and Playwright; record baseline and any preexisting problems.
4. Protect the owner's local SQLite database and uploaded images/manuals. No destructive seed or migration reset. Existing profile, jack, connection, scene and asset IDs must stay stable.
5. Preserve the portable rig format, legacy imports and all currently working planner-only workflows, even on a machine with no MIDI hardware.

## 2. Actual hardware and evidence

| Device | Expected connection | Important distinction |
|---|---|---|
| Morningstar **original MC8** (not MC8 Pro) | Computer USB; MIDI DIN Out; MIDI-output Omniports | Manufacturer documentation supports Cross MIDI Thru USB → DIN/Omniports for PC, CC, Note and Clock (plus other selected channel messages). Omniports cannot send SysEx, and are output-only. Actual MC8 firmware, port configuration and route behavior still require testing. |
| Morningstar **ML10X** | USB MIDI and 5-pin DIN In / **physical** Thru | Provide external power per verified hardware spec. Its physical Thru is a DIN input copy, **not** proof that USB messages are forwarded to Thru. Reuse existing compiler/firmware restrictions. |
| Strymon **Volante** | USB MIDI; TRS MIDI via configured jack | Nixie 2 currently lists Volante as supported; verify real firmware/settings and operating-system port availability. |
| Strymon **Zelzah** | USB MIDI and/or TRS MIDI only as independently documented for the exact unit | **Do not claim Nixie 2 support** merely because it has USB/MIDI; current Nixie 2 support list omits Zelzah. |
| Strymon **Sunset** | MIDI over EXP/TRS jack with compatible firmware/interface | Do **not** model Sunset as a confirmed direct USB MIDI endpoint; USB firmware updating is different from general MIDI control. Nixie 2 does not list Sunset. |
| Source Audio **Collider** | Confirmed USB MIDI / DIN MIDI as actually documented for the exact unit | A USB connection does not automatically make the proprietary Neuro editor protocol available to Signal Loom. |
| Meris **Hedra**, **Enzo** (original) | MIDI via Meris-compatible TRS wiring and the user's **Meris MIDI I/O** | No direct USB MIDI assumed. Verify MIDI I/O physical routing, TRS standards, channels and any Thru chain hop by hop. |
| Strymon **TimeLine MX**, **BigSky MX** | Planned/other reference profiles | Do not require either for Session 4's real hardware validation. |

Document manufacturer links and evidence levels in docs/research.md, keeping facts separated from observations on the actual board. Fill in missing MIDI/CC profile details progressively, starting with the pedal used in the first test; do **not** invent an exhaustive CC map to satisfy a checklist.

Sources to verify during research:
- Morningstar MC8 manual: https://help.morningstar.io/en/article/mc8-user-manual-1fzlzjx/
- Morningstar USB ↔ DIN/Omniport forwarding: https://helpdesk.morningstar.io/support/solutions/articles/43000681102-does-the-mcx-pass-midi-messages-through-from-midi-in-to-usb-midi-
- Strymon Sunset MIDI over EXP: https://www.strymon.net/faq/control-sunset-with-midi/
- Strymon Nixie 2 supported devices: https://www.strymon.net/support/nixie-2/

These references establish published claims; actual hardware configuration and behavior must be independently observed and labeled.

## 3. Backend-owned MIDI architecture

FastAPI is the **sole MIDI port owner within Signal Loom**. Next.js UI communicates over HTTP/WebSocket, never Web MIDI. Adapt structure as necessary:

```text
backend/app/live/
  transport.py     transport protocol / enumerator / receive callbacks
  rtmidi.py        real implementation (optional system dependency)
  virtual.py       simulated devices and buses for tests and user demos
  bindings.py      OS-specific endpoint ↔ rig instance/route assignments
  sender.py        armed sender, ordered queue, delay, Stop and send log
  monitor.py       incoming messages, decoding and scene follower
backend/app/vendors/
  ...              researched, evidence-tagged per-family capabilities
backend/app/api/live.py
```

Requirements:
- Bindings and enumerated OS endpoint names are **workstation-local**, keyed to the rig and saved apart from the portable rig document; physical cables remain ordinary rig connections.
- Several pedals may share **one upstream port**, but the binding must include the actual downstream route and MIDI channel. One port ≠ one device.
- Keep all available Signal Loom-owned endpoints open simultaneously; UI selection does not churn port connections. Provide clear handling when another app owns a port.
- Reconnection is detect-and-rebind only; it **never re-arms** or resends a scene.
- MIDI callbacks cannot block FastAPI's event loop; use thread-safe handoff.
- Virtual transport is a real user-selectable simulation mode and runs without hardware or native MIDI libraries. Never silently substitute virtual for physical without showing that fact.
- Vendor-specific behavior is isolated from the compiler and generic scene models.

## 4. Route graph, shared channels, and coverage

Model a computer endpoint as the origin, with directed USB, DIN, physical Thru, and TRS MIDI hops. Each hop tracks PC/CC/clock/SysEx-read capability, direction and evidence (published / unknown / simulation-tested / hardware-verified), plus prerequisites such as MC8 Cross MIDI Thru and Omniport mode.

**Collision scope is a shared downstream receiver network, not the entire computer or just the shared MC8 USB uplink.** Two separate USB endpoints can use MIDI channel 1 independently. Two independently addressed pedals sharing a single DIN bus may conflict if both respond on channel 1; deliberate broadcast/group channel behavior should be explicit and not silently rejected.

Coverage table: one row per device × message kind, with source endpoint, route/hops, chosen channel, status and specific reason. Flag unsupported routes. An *unknown/unverified* route must not show as verified reachability. A missing connection can suggest the smallest plausible, evidence-based configuration/cable change, with appropriate wiring/pinout uncertainty.

Reference configurations:

1. **MC8 as single computer USB interface (PC/CC-first).** Computer USB → MC8. MC8 DIN Out → ML10X MIDI In → ML10X physical Thru → Collider MIDI In → Collider MIDI Thru → Meris MIDI I/O → Hedra and Enzo. Volante, Zelzah and Sunset may be attached to appropriately configured MC8 MIDI-output Omniports if their wiring is verified. Channel assignments distinguish downstream pedals; three Omniports used for MIDI leave one for expression. Cross MIDI Thru USB→output for PC/CC is documented, but this **particular hardware chain is not verified**. Never infer end-to-end SysEx or an Omniport return path.
2. **Powered USB hub with a single upstream computer cable.** Computer USB → powered hub, optionally via a USB isolator **only after compatibility testing**. Separate USB connections for MC8, ML10X, Volante and other *verified direct USB MIDI* devices. **Sunset stays on EXP/TRS MIDI**; Hedra and Enzo remain on a compatible DIN/TRS Meris route. Do not assume direct USB SysEx, editor software support, or shared access between Nixie/Neuro and Signal Loom. Hub power, device enumeration and ground noise are practical test concerns.
3. **Mixed topology** uses the best actually supported route per target/message type. Do not replug physically to switch selected device. Releasing a port *in software* when an external editor requires it is permissible and must be explained.

**Safety of the hardware plan:** MC8 scene/stomp operation must remain standalone when the computer is removed. Do not reroute performance-critical MIDI through the PC.

## 5. Ordered implementation gates

### P0a — First acceptance milestone: virtual end-to-end PC/CC

Complete and test **before** the more ambitious features:

1. Enumerate virtual ports and assign bindings for a demo rig with multiple pedals on a shared simulated downstream bus.
2. Show which routes are supported and which are uncertain/unsupported. Catch shared-bus channel clashes without mislabeling independent USB endpoints.
3. A selected scene dry run displays the exact compiled PC/CC messages, destination, channel, order and explanations, and makes **zero transport sends**.
4. Explicitly arm the virtual rig; audition the scene, transmit ordered messages with a configurable, conservative delay and Stop; simulated pedal program/bypass/parameter state updates.
5. Manipulate one control on a generated panel and deliberately **Capture to Scene**, preserving the existing scene shape and manual/MIDI command-library snapshots.
6. Persist/reload the scene via the existing safe revision/save pipeline. Disconnect or Stop cancels queued messages and disarms as appropriate. No output happens automatically.
7. CI exercises all of this with no hardware; browser Playwright covers armed audition, send log, panel edit/capture and independent offline planner use.

### P0b — Windows-first physical validation

The owner validates **one documented PC and one safe CC on one real pedal**, at a safe volume, recording before/after behavior and how to restore the previous preset. Then progress through the MC8 DIN and Omniport chain. The autonomous agent prepares a checklist and evidence records; it must **not claim** CI or a virtual transport validates the real rig.

### P1 — Reusable live panels and capture

Expand the existing `DeviceProfile.midi`, named command favorites, and `Scene.device_states` rather than introducing a second parameter/CC registry. Generate per-pedal controls from source-supported ranges and value semantics, with bounded/coalesced CC sends during slider drag. Include PC selection, explicit bypass semantics and confirmation of toggles.

Show **last sent by Signal Loom**, **observed reply**, and **simulated state** as distinct categories. Most pedals do not report their current parameters. A panel change does not automatically rewrite the user's scene. Capture is deliberate, undoable and versioned. A scene selection should never secretly send MIDI.

### P2 — MC8 observation and setlist

Listen for observed messages on available MC8 USB input, compare with compiled scene plans, and show "possible active scene" if the evidence is ambiguous or incomplete. Do not claim to know which footswitch was pressed or that the pedal's state changed unless observability is verified. Use existing scenes/songs/sections; avoid a new parallel setlist model. MC8 memory writes are out of scope.

### P3 — Optional research only

After P0–P2 pass end-to-end: optional MIDI Clock (measure jitter, off by default), explicitly approved and documented **read-only** SysEx/Identity Request over a verified route, further per-vendor capabilities. No writer, patch downloader, firmware update, auto-detection of arbitrary proprietary SysEx, or broad reverse-engineering digression.

## 6. Automated and real-hardware validation

Required backend tests: arm/disarm, zero output while disarmed, binding and route changes, per-bus channel clashes, capability filtering, dispatch order, delay, cancellation, disconnect/reconnect, rejection of unauthorized message types, coalescing, capture-to-scene, snapshot preservation, ambiguous follower, virtual-mode fallback.

Required Playwright: live/disarmed visibility, dry-run, simulated arm/audition, signal received by simulated pedal, capture, reload and compile, simulated MC8 stomp with honest scene match, offline Board/Stage/manuals unaffected.

Produce `docs/live-hardware-validation.md` with reversible steps, each recording what is **documented**, **simulation-tested**, and **hardware-verified** by the user:
1. Monitor with all sending disarmed; inspect fixed cabling and real MIDI endpoints.
2. One physical PC/CC using a confirmed working endpoint (Volante USB is an option if recognized); **not** Sunset direct USB.
3. Validate ML10X receives a PC while externally powered. Keep its physical Thru distinct from its USB path.
4. Validate MC8 Cross MIDI Thru USB → DIN → ML10X → physical Thru → Collider → Meris MIDI I/O → Hedra and Enzo, **one hop at a time**; record required firmware/settings, channel and observable response.
5. Validate USB → MC8 Omniport → each connected TRS MIDI Strymon pedal separately. Do not assume SysEx passes; Omniports have no MIDI input return path.
6. Safely audition one real scene and compare observed effects with intended messages.
7. Observe MC8 footswitch traffic; record whether anything is echoed to USB and whether scene following can be positively identified.
8. Optional hub topology validation and optional compatible isolator/noise assessment, **without** automatically promising Nixie/Neuro access.

## 7. Completion criteria

- The full Session 3 application remains usable with no hardware; legacy rigs, documented manuals, MIDI favorites, images, power/underside and exports are backward compatible.
- Virtual P0a passes completely; sending while disarmed is impossible and automated tests prove it.
- One physical PC/CC check is written as a user-run test with reversible steps, never invented as completed.
- Workstation-local bindings, hot-plug/disarm behavior and transport capabilities are correctly represented.
- Each actual route has accurate PC/CC/clock/SysEx coverage and evidence level; deliberate shared channels are explicit, and independent endpoints are not incorrectly flagged.
- Scene audition uses the **existing compiler**; capture writes ordinary versioned scene data and exact values are inspectable.
- An MC8 scene follower never overstates incomplete observations.
- The board's standalone MC8 control does not depend on a computer.
- CI runs in a virtual environment without connected MIDI devices or native MIDI dependencies.
- No patch memory writes, SysEx mutations or unauthorized output.
- README, ARCHITECTURE.md, docs/research.md and the hardware checklist are current.
- `SESSION-4-RESULTS.md` documents architecture, outcomes, exact test counts, evidence gaps, screenshots, limitations and remaining work.

## 8. Open decisions — defaults for the agent

- **Computer interface:** Model both MC8 and powered hub, prefer the MC8 as the initial PC/CC path; do not assert every device is reachable until its hops are validated.
- **Operating system:** The owner's immediate local testing is on Windows. Support other OSes architecturally; test Linux CI using virtual ports.
- **Meris:** The owner has a Meris MIDI I/O; validate actual signal direction and channel configuration on hardware.
- **Sunset:** Use documented EXP/TRS MIDI, not a presumed direct USB MIDI endpoint.
- **USB isolator:** Optional compatibility/noise experiment, not an assumed requirement.
- **Control source of truth:** A scene is planned intent, a send log is the last attempted/sent message, and an actual hardware response is separate observational evidence.
- **Future BigSky MX and TimeLine MX:** No dependency on unowned hardware.

## Delivery protocol

1. Produce a short reconnaissance/implementation plan and baseline results.
2. Land P0a as a coherent tested milestone **before** beginning P1/P2. Preserve the one-cable and safety constraints.
3. Commit incremental work to a new Session 4 implementation branch based on merged Session 3; this charter branch may be the starting point once Session 3 is merged.
4. Open a separate **draft PR** against the latest `main`; never merge it automatically.
5. Leave explicit unknowns as unknown. Tell the owner which real tests to run and how to record results.

**Defining test:** Can a guitarist keep one fixed USB connection to the board, understand which pedals are really reachable, safely audition the compiled scene, dial in a control, and capture that intention—while preserving standalone MC8 operation and never sending MIDI unexpectedly?
