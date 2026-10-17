
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
