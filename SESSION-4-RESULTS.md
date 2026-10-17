# Signal Loom — Session 4 results: Live Rig Control

> Implementation branch `experiment/session-4-live-control`, started from `session-4-live-control`
> (the charter on top of merged Session 3 `main`). Draft PR against `main`; not merged.

## Baseline (before any edit)

| Check | Result |
|---|---|
| `backend: python -m pytest -q` | 106 passed, 4 skipped (external MC8/ML10X fixtures not downloaded) |
| `ruff check` / `ruff format --check` | clean |
| `npm run lint` / `typecheck` / `build` | clean |
| Playwright (production build, Chromium 1194, backend on a scratch DB) | 40 passed |

Toolchain in the sandbox: Python 3.13.16, Node 22.22, npm 10.9. `python-rtmidi` cannot be
installed here (no wheel builds; no MIDI hardware), which is exactly the CI condition the charter
asks for: everything below runs on the virtual transport.

## Execution plan (written before the edits)

1. **Workstation-local live bindings** (`models/live.py`, migration `0005_live_bindings.sql`,
   `live/bindings.py`): per rig, stored apart from the rig document and never exported.
2. **Transport protocol + virtual transport** (`live/transport.py`, `live/virtual.py`): PC/CC only,
   enumerable endpoints, a send log, simulated pedals attached to an endpoint's receiver network,
   an injectable virtual MC8 USB input. `live/rtmidi.py` is the optional real implementation
   (import-guarded; not exercisable in this sandbox).
3. **Route graph and coverage** (`vendors/*`, `live/routes.py`): computer → USB binding → device →
   MIDI cables, each hop with PC/CC/clock/SysEx-read capability, evidence and prerequisites;
   per-receiver-network channel collisions; one coverage row per device × message kind.
4. **Armed sender, monitor, service** (`live/sender.py`, `live/monitor.py`, `live/service.py`):
   disarmed at every start/disconnect/lost binding; dry run never touches the transport; ordered
   queue with a conservative delay, Stop, coalescing, toggle confirmation, forbidden-type rejection.
5. **API** (`api/live.py`): status, endpoints, bindings, coverage, connect/disconnect, arm/disarm,
   dry-run, audition, send, stop, log, panels, follower, virtual stomp injection; loopback-only.
6. **Backend tests** for every rule in charter §6; then the **Live tab** in the UI (coverage,
   bindings, arm, dry run vs audition, send log, generated panels, capture to scene through the
   existing store/revision pipeline, MC8 follower) and **Playwright** scenarios.
7. **Docs**: `docs/live-hardware-validation.md`, research evidence, ARCHITECTURE, README, this file.

P0a lands as one tested milestone before P1/P2 refinements.

## What was built

P0a — the virtual end-to-end PC/CC milestone — is complete and tested; P1 (panels and capture)
and P2 (MC8 observation and follower) are implemented in their first useful form on the same
foundation. P0b (real hardware) is prepared as a user-run checklist and **not** claimed.

### Backend (`backend/app/live`, `backend/app/vendors`, `backend/app/api/live.py`)

- **Transport protocol and the byte choke point.** `transport.encode` builds PC and CC bytes and
  refuses every other type (`ForbiddenMessageError`); `decode` only interprets PC/CC for display.
- **Virtual transport.** Per-rig simulated endpoints (one USB out per device whose profile lists
  USB MIDI, an input for controllers, a generic interface), a receiver network per endpoint,
  channel-filtered simulated pedals with program/bank/bypass/CC state, `inject` for simulated
  controller traffic, `set_busy`/`unplug` fault injection, and a record of every byte string sent.
- **rtmidi transport.** Import-guarded `python-rtmidi` implementation (optional extra
  `pip install -e ".[live]"`), busy-port detection with an explanation; reports itself unavailable
  with the reason. *Written against the API, not run here.*
- **Workstation-local bindings.** `LiveBindings` per rig (endpoint ↔ device jack, deliberate
  channel groups, send delay, user-recorded verified hops) in table `live_bindings` (migration
  0005), deleted with the rig, never in a project file. Changing bindings disarms.
- **Route graph and coverage.** Computer → bound endpoint → device jack → vendor forwarding →
  the rig's MIDI cables → …, with a `Capability` (status, evidence, prerequisites) per hop and
  message kind. Coverage per device × kind = weakest hop of the best route: supported /
  unverified / unsupported / unreachable (with the smallest plausible change). Receiver-network
  collisions (`live.channel_collision`) and declared sharing (`live.channel_group`).
- **Vendor tables** (isolated from the compiler): MC8 Cross MIDI Thru USB → DIN (PC/CC/clock
  published, SysEx unknown) and → Omniports (SysEx unsupported, output-only); ML10X In → Thru
  (hardware copy, published), USB → Thru (unknown, never inferred); Sunset EXP-only MIDI with its
  prerequisites, USB unsupported; BigSky MX THRU setting; generic rules (a `thru` port is unknown
  until documented; a USB jack not listed under `midi.interfaces` is not a MIDI endpoint).
- **Armed sender.** Disarmed at construction and on every transport change, bindings change, lost
  endpoint, transport error and shutdown; arm phrase `send MIDI to my rig`; dry run is pure;
  audition queues ordered messages with the configured delay (default 20 ms) on one worker thread;
  `stop` cancels queued messages and logs that transmitted ones are not undone; slider CCs
  coalesce per device/controller; toggles need explicit confirmation; unsupported/unreachable
  routes are refused, unverified ones warned; a per-rig send log and "last sent" per device.
- **Monitor and follower.** Thread-safe inbox (callbacks never block the event loop), last PC/CC
  per channel as *observation*, and a follower that says at most "possible active scene".
- **Service and API.** One `LiveService` on `app.state.live`; `/api/live/*` is loopback-only
  (peer and `x-forwarded-for` both checked, so a remote browser behind the Next.js proxy is refused).
  Endpoints: status, endpoints, mode, refresh (detect-and-rebind, never re-arm), release/reacquire
  (hand a port to an external editor on purpose), bindings (get/put/suggest), coverage,
  connect/disconnect, arm/disarm/stop, dry-run, audition, send, panels, follower, events,
  virtual inject.

### Frontend (`frontend/src/components/live`, `frontend/src/store/liveStore.ts`)

A **Live** workspace (`#live`) with: transport choice and the honest reason when real ports are
unavailable; endpoint list with busy/missing/released state and release/reacquire; bindings editor
and virtual suggestion; receiver networks with collisions and a one-click "declare shared on
purpose"; the coverage table with per-row "why" (hops, prerequisites, suggestions); scene dry run
(bytes, endpoint, route status) vs audition (disabled until armed), delay, Stop, send log; generated
pedal panels (PC, bypass, documented CCs rendered from their value semantics — engage/bypass pairs,
confirmed toggles, bank ranges, sliders — and named commands), the three state columns, and
"Capture to scene…" with a preview that writes through the ordinary store (undo, revision, PUT);
controller observation with the follower and, in virtual mode, simulated stomps. The rig header
shows a red **ARMED** badge on every tab while the backend is armed for that rig.

### Documentation

`docs/live-hardware-validation.md` (eight reversible steps with a record template),
`docs/research.md` §8 (route evidence table and the known unknowns), ARCHITECTURE.md (live
section), README (Live tour, optional extra), screenshots in `docs/screenshots/session-4/`.

## Verification (performed, with the numbers)

| Check | Result |
|---|---|
| `backend: python -m pytest -q` | **130 passed, 4 skipped** (24 new: `test_live_sender.py` 10, `test_live_routes.py` 6, `test_live_api.py` 8; the skips are the external MC8/ML10X fixtures) |
| `ruff check` / `ruff format --check` | clean |
| `npm run lint` / `npm run typecheck` / `npm run build` | clean |
| Playwright (production build, Chromium 1194, fresh scratch DB) | **43 passed** (40 previous + `e2e/live.spec.ts` 3) |
| Screenshots | `docs/screenshots/session-4/live-1…5.png`, inspected |

Charter §6 backend requirements, each with its test: arm/disarm (`test_arm_requires_the_phrase…`,
`test_attaching_a_transport_again_disarms_never_rearms`), zero output while disarmed
(`test_disarmed_by_default_and_nothing_sends_while_disarmed`, with a transport whose `send`
raises), binding and route changes (`test_toggle_needs_confirmation_and_unsupported_routes…`,
`test_best_route_per_kind…`), per-bus channel clashes (`test_collisions_are_scoped_to_a_receiver_
network…`), capability filtering (`test_usb_jack_without_documented_usb_midi…`,
`test_forwarding_is_never_inferred…`), dispatch order and delay (`test_audition_sends_in_order…`),
cancellation (`test_stop_cancels_queued…`), disconnect/reconnect and hot-unplug
(`test_disarm_and_disconnect_drop_the_queue`, `test_hot_unplug_disarms_and_reconnect_rebinds…`,
`test_restart_starts_disarmed…`), rejection of unauthorized message types
(`test_encode_only_pc_and_cc…`, `test_rejects_forbidden_types…`), coalescing
(`test_coalescing_keeps_only_the_newest_value…`), capture-to-scene and snapshot preservation
(`test_virtual_round_trip…` through the ordinary rig PUT; the browser scenario covers the
command-snapshot path), ambiguous follower (`test_follower_reports_possible_ambiguous…`),
virtual-mode fallback refused (`test_cold_start_is_disarmed…`), remote clients
(`test_remote_clients_are_refused`).

Charter §6 Playwright: live/disarmed visibility, dry run, simulated arm/audition, signal received
by a simulated pedal, capture, reload and compile, simulated MC8 stomp with honest scene match,
offline Board/Stage untouched — all in `e2e/live.spec.ts`; manuals and the other 40 scenarios run
unchanged against the same build.

## Decisions worth knowing

- **Collision scope** is the receiver network behind one bound endpoint, and the entry device
  (MC8) is a member on its own channel: a PC on channel 16 into the MC8's USB jumps its bank.
- **Best route per kind** prefers status, then evidence, then fewer hops. With both the MC8 uplink
  and a pedal's own USB bound, the direct USB wins for that pedal; the virtual suggestion binds only
  the controller so the demo exercises the one-cable chain.
- **Virtual delivery** follows the modelled routes: a message is delivered to a simulated pedal
  when the route is supported or unverified (not when unsupported) and the pedal is on the
  channel. It is a simulation of the evidence table, never evidence itself; the UI labels it.
- **Capture reads "last sent" only.** Simulated and observed state are shown beside it but never
  written into a scene. Bank CCs travel with the program; the bypass CC becomes `enabled`.
- **Per-rig log and per-session observations.** The send log is stamped with the connected rig;
  observations are cleared on connect (found by the browser suite when two scenarios shared the
  process).
- **Planner warning kept.** `midi.channel_shared` still describes the MC8's own output; the new
  per-network diagnostics are the live layer's.

## Limitations and honest unknowns

- **No hardware was touched.** `python-rtmidi` does not build in the sandbox; `rtmidi.py` is
  unexercised. Everything "supported" in the coverage table means *documented by the
  manufacturer*, never measured on the owner's board.
- The demo rig models ML10X → BigSky MX over the ML10X Thru; the owner's Collider, Meris MIDI I/O,
  Hedra, Enzo, Volante and Zelzah are **not shipped profiles** (deliberately: no invented CC maps).
  Added by the user in the Device library, they fall under the generic rules (unknown until tested).
- Whether the real MC8 echoes footswitch traffic for DIN/Omniport messages to USB is unknown; the
  follower is only as good as that and says so.
- The follower matches a five-second window of exact PC/CC tuples; a scene whose messages are a
  subset of another's will read as ambiguous, which is the intended behaviour.
- CC controls are 0–127 sliders unless the documented semantics match one of a few exact phrasings
  (engage/bypass ranges, "any value toggles", "0-n = Banks"); no other ranges are inferred.
- MIDI Clock and read-only SysEx appear in the coverage table but are never sent (P3 not started).
- The API polls (700 ms) rather than streaming over WebSocket; adequate for a send log, not for
  high-rate monitoring. The sender is one worker thread per process.
- Port names on Windows are whatever the OS reports; duplicates ("… 2") are bound by exact name.

## Remaining work

1. P0b with the owner on Windows: run `docs/live-hardware-validation.md`, send the record back;
   update vendor tables and profiles from it (evidence `user`, hops `hardware_verified`).
2. Profiles for the actual board (Volante, Zelzah, Collider, Meris MIDI I/O, Hedra, Enzo): jacks
   and channels first, CCs only as documented or tested.
3. P2 refinements once step 7 of the checklist answers whether the MC8 echoes to USB.
4. P3 (optional): MIDI Clock with jitter measurement, per-device opt-in read-only identity
   request over a verified route.

## Review follow-up (PR #4 comment, 2026-10-17)

The owner's review asked for two safety fixes before any physical sending and three hardening
items. Each is addressed on the same branch, with the data model, scenes, command snapshots and the
earlier regression suite preserved.

1. **Disarm/Stop race in the worker — fixed, with deterministic tests.** The worker now dequeues,
   re-checks `armed` and calls `transport.send` inside one critical section, and every control call
   (`disarm`, `stop`, `attach_transport` for connect/disconnect/mode switch, `close`, and the
   service's disconnect / release / mode switch / bindings save) first announces itself so the
   worker yields between messages, then takes the same lock. Semantics are explicit: a control call
   returns only when no send is in flight; no send begins after it returns; the one message already
   handed to the driver completes and is logged as sent; everything behind it is cancelled; the log
   says transmitted messages are not undone; `status.in_flight` shows the message being handed over.
   `tests/test_live_race.py` forces the exact interleaving with a transport that blocks inside
   `send` (Events, no timing): disarm / stop / disconnect / close at the sender, disconnect / release
   / mode switch through the service, and a disarm that wins the race (nothing sent). Finding on the
   way: the watcher thread held the service lock while waiting for the sender lock, which let a
   disconnect lose its priority; the `hold_worker` announcement is taken before any lock for that
   reason, and the `armed` flag is read lock-free.
2. **Hot-unplug detection is automatic — fixed.** `LiveService` runs a watcher thread while a rig
   is connected (`check_endpoints`, every `SIGNAL_LOOM_LIVE_WATCH_S` s, default 1.0): a vanished
   bound endpoint is closed and marked and an armed session is disarmed; a returned endpoint is
   re-opened, never re-armed; the simulated world is not reset (unlike manual Rescan). Tested without
   any rescan or send: `test_idle_armed_session_is_disarmed_automatically_when_an_endpoint_vanishes`
   (API, virtual) and the service test on the rtmidi fake. The header badge shows the watch.
3. **Unverified routes and prerequisites are acknowledged before anything is queued — changed.**
   Each resolved message carries `needs_ack` (the route's hardware prerequisites and, for an
   unverified route, the undocumented hop by name). The sender refuses with `409 live.confirm_route`
   and the exact items until the request echoes them back; acknowledgements last for one
   connection session; a dry run lists them as `confirmations_required`. The UI shows the list in a
   dialog ("I have checked these — send") before the first audition or panel send; the e2e scenario
   covers it. The post-send warning remains informational only.
4. **Duplicate Windows port names — handled.** rtmidi endpoint ids are `rtmidi:<dir>:<name>#<k>`
   with `k` the ordinal among same-named ports; `_index` resolves the k-th occurrence and reports a
   missing ordinal instead of opening another port. A binding records `peer_count` at save time
   (server-side); when the enumerated count differs the binding is held closed as *ambiguous* and an
   armed session is disarmed until the user re-saves it. The UI shows "N ports share this name" and
   the held state.
5. **Real-transport fidelity — tested against a fake of the python-rtmidi API.**
   `tests/test_live_rtmidi.py`: unavailable library, enumerate with duplicates, open by ordinal,
   send, idempotent open, close, busy port (`PortBusyError`), disappearance (`TransportError`, no
   remap), input callback delivery with SysEx/timing/active-sense ignored and a raising callback
   contained, and the service in `rtmidi` mode: bind by ordinal, audition reaching the fake driver,
   automatic disarm on a count change, rebind after re-plug, ambiguity hold and re-save. This is
   adapter verification, not hardware verification: P0b stays a separate user-run milestone.

Verification after the follow-up: backend **144 passed, 4 skipped** (14 new: race 6, rtmidi 5,
sender 1, API 2); ruff clean; frontend lint/typecheck/build clean; Playwright **43 passed** on a
production build with a fresh database (the live scenario now exercises the acknowledgement
dialog and the watch badge).

Open questions for the owner: (a) the watcher's default interval of 1 s costs one `MidiOut`/
`MidiIn` probe per second on Windows; if WinMM enumeration proves noisy or slow on the workstation,
raise `SIGNAL_LOOM_LIVE_WATCH_S`; (b) ordinals are the best identity WinMM offers — if two
identical devices are both on the board, plugging order decides which is `#0`, so the first real
test should use distinct devices or a single MC8 uplink.

### Second follow-up: enumeration failures fail closed

The reviewer's last note: a port check that could not enumerate only logged the error and left an
armed session armed. Now `check_endpoints` (and the watcher's catch-all) treat any enumeration
exception as "cannot verify the bound ports": while armed, or with messages queued, the sender is
disarmed and the queue dropped, with the driver's message in the disarm log entry and in
`status.last_check_error`; every endpoint state carries the failure; a later successful probe clears
the error and rebinds, and the session stays disarmed until the user re-arms. Tests:
`test_a_failed_port_enumeration_fails_closed_while_armed_and_never_rearms` (API, virtual transport,
with a pending audition) and `test_watcher_fails_closed_when_the_native_enumerator_raises_while_armed`
(rtmidi fake, the watcher thread acting on its own). Backend 146 passed, 4 skipped; Playwright
unchanged at 43.
