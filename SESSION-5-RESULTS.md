# Signal Loom — Session 5 results: the first playable whole-rig instrument

> Implementation branch `experiment/session-5-creative-instrument`, started from `main` at
> `530f413` (Session 4 PR #4 merged at `ef07632` plus the Session 5 charter). Draft PR against
> `main`; **not merged**. Direction: [SESSION-5-DIRECTION.md](SESSION-5-DIRECTION.md); checkpoint
> ledger: [SESSION-5-PROGRESS.md](SESSION-5-PROGRESS.md).

## Baseline (before any edit)

| Check | Result |
|---|---|
| `backend: python -m pytest -q` | 147 passed, 4 skipped (external MC8/ML10X fixtures) |
| `ruff check` / `ruff format --check` | clean |
| `npm run lint` / `typecheck` / `build` | clean |
| Playwright (production build, fresh DB) | 43 passed |

Sandbox: Python 3.13.16, Node 22.22. `python-rtmidi` is not installed and no MIDI hardware is
attached: everything below runs on the virtual transport, exactly the CI condition. Playwright
1.64 expects Chromium 1248; the pre-installed 1194 was used through `PW_CHROMIUM` locally (CI
installs its own browser).

## The journey that now works

A guitarist opens a rig and picks **Instrument**. The **Undertow** texture (created on demand from
the rig library's *synthetic instrument demo*, or any texture the user authors) shows what it is
musically, which Scene it starts from, its tempo, and one large **Bloom** macro with a triangle LFO.
Below it the rig is grouped by function, and the patch list shows Bloom → Virtual Pedal A CC 21
**100 → 30** and Bloom → Virtual Pedal B CC 22 **15 → 110**: one gesture, two pedals, opposite
directions, with the exact seven-bit values at macro 0 / ½ / 1 and a live preview value. Moving the
macro, changing the tempo, the LFO cycle or its depth, saving, reloading — none of it transmits.
Pressing **Connect rig (virtual)** binds the simulated USB endpoints and connects; **Arm** needs the
Session 4 phrase; **Start performance** is a third, separate button, enabled only when the readiness
report says every enabled destination is eligible, routed to an open endpoint and acknowledged.
While performing, both simulated pedals receive values inside their ranges that track one effective
value (A falls as B rises), at most two messages per 100 ms in total and one per destination,
unchanged values are deduplicated, the lease is renewed by the controlling tab and the counters
show planned / handed / deduplicated / deferred. **Stop** ends it: nothing is handed afterwards,
the reason is shown, and the saved idea is untouched by the performance (its runtime values never
enter the document). Renaming the texture and reloading brings it back as authored.

## What was built

### Backend

- **Textures on the rig document** (`models/texture.py`, `Rig.textures`, migration
  `0006_textures.sql`, repository, PUT validation, export omission of an empty key, template
  `POST /api/rigs {template: "virtual_instrument"}`). Older rigs load with zero textures;
  duplicate/import keep ids; dangling references are warnings (`texture.scene_missing`,
  `texture.instance_missing`), never repairs.
- **Eligibility** (`instrument/eligibility.py`): documented continuous (`CcDef.continuous`, new,
  None everywhere except BigSky MX CC 100), synthetic fixture, or user-declared with a mandatory
  note; hard refusals for CC 0/32, 120–127, bypass CCs, documented switches, discrete controls and
  engage/bypass/toggle commands. The physically verified Sunset CC 10/15 are refused as bypass
  switches.
- **Evaluator** (`instrument/evaluator.py`): the §5 contract with one half-up rounding function,
  triangle phase points fixed, NaN/∞/bounds refused.
- **Analysis** carries `analysis.textures` (eligibility and values at 0/½/1 per mapping).
- **Sender streaming path** (`live/sender.py`): `open_stream` / `stream_one` (coalesced per
  device/CC, quiet, refused once the job ended) / `cancel_job` (a control call) / `on_disarm`
  hooks / `pending_discrete`.
- **Performance engine** (`live/performance.py`): `Clock` abstraction with `RealClock` and
  `FakeClock`; states idle / performing / stopped / fault; 5 s lease with heartbeat; 100 ms tick; 2
  handoffs per tick aggregate, 1 per destination; dedup; deferral instead of queueing; round-robin;
  phase freeze on tempo/division change; Stop that cancels, finishes the job, waits for in-flight
  and joins the thread; stops on any sender disarm.
- **Service and API**: readiness, Start (structural blockers first, then route acknowledgements),
  Stop for any local client, heartbeat and params for the controller only; auditions/panel sends
  refused while performing (`409 live.performing`); `status.performance`; all loopback-only.
- **Virtual fixture**: `signal-loom-virtual-pedal-a/b` (`provenance.source = synthetic_fixture`,
  reception `supported / simulation_tested`), the Undertow rig template.

### Frontend

- **Instrument tab** (first tab; Board remains the default): texture list (new / duplicate /
  delete), *What am I playing?* (name, intent, starting scene, tempo, macro slider, LFO), *What
  does it move?* (function groups with editable roles, patch list with ranges, direction, values,
  eligibility, route, add/remove destinations, override with note), *What is happening?* (state
  badge, connect / arm / Start / Stop / disarm, route-acknowledgement dialog, blockers, the
  not-yet-controllable state with the demo offer, destinations with asked-now and last-commanded,
  counters, lease).
- `lib/instrument.ts` (evaluator mirror, function lens), `store/instrumentStore.ts` (controller
  id, heartbeat owned by the rig page, throttled params, readiness), rig store texture helpers,
  header PERFORMING badge, rig-library template option, reduced-motion-safe animation.

## Verification (performed, with the numbers)

| Check | Result |
|---|---|
| `backend: python -m pytest -q` | **193 passed, 4 skipped** (46 new) |
| `ruff check app tests` / `ruff format --check app tests` | clean |
| `npm run lint` / `npm run typecheck` / `npm run build` | clean |
| Playwright (production build, fresh DB, one worker) | **RESULT_PLACEHOLDER** |
| GitHub Actions on the final PR head | CI_PLACEHOLDER |

New backend tests: `test_instrument_evaluator.py` (9), `test_instrument_eligibility.py` (6),
`test_instrument_model.py` (6), `test_performance_engine.py` (14), `test_instrument_api.py` (5);
`test_persistence_api.py` updated for migration 0006. New Playwright file: `e2e/instrument.spec.ts`
(4 scenarios); the 43 existing scenarios run unchanged on the same build.

### Acceptance matrix (charter §9) — where each item is proven

**Domain and numerical model**
- Legacy import / zero textures / no scene loss: `test_legacy_database_loads_with_zero_textures…`,
  `test_export_of_a_rig_without_textures_omits_the_key…`; round trip save/reload/duplicate/
  export/import/restart: `test_texture_round_trip…`, `test_texture_survives_a_backend_restart`.
- Dangling device/scene → warning, never retargeted: `test_validation_unique_ids_and_bounds_and_
  dangling_references…`, eligibility `test_missing_device_profile_or_channel…`.
- Macro 0 / ½ / 1 forward and reverse with exact rounding, triangle quarter/half/full cycle,
  BPM/division, depth 0, invalid inputs: `test_instrument_evaluator.py` (all).
- CC eligibility refusals (toggles/bypass, unsupported, CC 0/32, 120–127, channel, unknown device,
  unsafe ranges via model bounds): `test_instrument_eligibility.py`.

**Runtime safety**
- Zero sends from opening/selecting/editing/saving/previewing/refreshing while armed:
  `test_preview_readiness_and_editing_never_send_even_when_armed`; e2e journey (`sentOrQueued == 0`
  before Start, and after arming).
- Start refused disarmed/disconnected/not ready/unacknowledged: `test_start_is_refused_for_
  ineligible_unacknowledged_or_pending_states`, `test_preview_readiness…`.
- Budgets, boundedness, newest wins, dedup under a fake clock: `test_budget_dedup_and_round_robin…`,
  `test_unchanged_values_are_deduplicated…`, `test_newest_value_wins…`.
- Stop during in-flight, disarm, release/unplug, transport error, mode change, shutdown, lease:
  `test_stop_during_an_in_flight_send…`, `test_any_sender_disarm_stops…` (disarm / transport
  change / close), `test_a_driver_error_fails_closed…`, `test_lease_expiry_stops…`,
  `test_disarm_disconnect_and_lease_expiry_stop_a_running_performance` (disarm, unplug via the
  watcher, disconnect, lease, bindings change), e2e safety scenario (second tab, disarm, lease).
- Restart idle and disarmed; second browser cannot assume control; auditions unaffected:
  `test_a_backend_restart_is_idle_and_disarmed…`, `test_only_the_controller_may_heartbeat…`,
  `test_start_performs_two_pedals…` (auditions refused while performing, work again after Stop);
  the Session 4 suites are unchanged and green.
- Localhost-only: `test_a_backend_restart_is_idle_and_disarmed_and_remote_clients_are_refused`.

**End-to-end product experience**
- The whole-rig texture, inverted ranges, tempo-related modulator, visual routing, honest status:
  `e2e/instrument.spec.ts` scenario 1; the not-controllable state on the real demo rig, bypass
  refusal, user declaration: scenario 3; phone width, reduced motion, keyboard: scenario 4.
- Screenshots: `docs/screenshots/session-5/` (captured from the production build and inspected).
- Board/Wiring/Stage/Scenes/Live/exports intact: the 43 pre-existing Playwright scenarios.

## Adversarial self-review (sender, engine, persistence)

No independent reviewer tool was available in the sandbox; this is the author's own pass.

- **Lock order.** Service → engine → sender, never the reverse: the sender's disarm hook records a
  stop request without taking the engine lock; `stop_performance` is called without the service
  lock; the tick hands values to the sender outside the engine lock. A control call that waits for
  an in-flight send can make `status()` wait with it (unchanged Session 4 semantics).
- **No late enqueue.** `cancel_job` finishes the job under the sender lock; `stream_one` refuses a
  finished job; the worker cancels a dequeued item whose job ended. Proven with a transport that
  blocks inside `send`.
- **Disarm racing a tick.** A value refused because the sender disarmed between evaluation and
  handoff finalises the pending disarm stop (reason preserved) rather than a bare fault.
- **Lease.** Expiry is checked on every tick by the backend clock; the browser heartbeat is
  separate from polling and owned by the rig page, so a tab switch keeps it and leaving the page
  (or a crash) ends it.
- **Persistence.** Textures are a child table synced like scenes; the texture-less export keeps the
  previous file shape; a *dangling* reference survives PUT, duplicate and import verbatim; the
  engine never writes the rig.
- **Found and fixed during review/e2e:** the Instrument tab's Connect left the simulation unbound
  (now binds simulated USB on that click); the heartbeat was torn down by a tab switch (moved to
  the rig page); the stop reason vanished after a tab switch (now from backend status); the
  destination table and rig header overflowed at phone width; two spec files drove the one live
  service from parallel workers (one worker now).

## Limitations and honest unknowns

- **No hardware was touched.** Everything "supported" means documented or simulated. A virtual
  performance is not physical verification. Real continuous modulation is pending the owner's own
  validation on two documented, suitable CC targets (see the checklist below).
- Among shipped real profiles only BigSky MX CC 100 (documented expression sweep) is marked
  continuous; Sunset CC 100 remains unknown. Any other sweep on real pedals is the user's declared
  claim, shown as such.
- One LFO shape (triangle), one modulation source per macro, no summing, envelopes, movements,
  transitions, Experiment Lab, MIDI Clock, SysEx, MIDI learn or expression input — deliberately
  deferred (charter §3).
- A macro drag produces many document edits (each an undo step and a debounced save); fine for
  the demo, worth coalescing later.
- A second tab editing a texture's macro while another tab performs changes the saved base but
  not the running stream (params need the controller id); the controlling tab then sees the usual
  stale-revision notice on its next edit.
- The performance engine's status is polled (700 ms); the lease is 5 s; both are configurable
  only through code/env (`SIGNAL_LOOM_PERFORM_LEASE_S`).

## Owner acceptance checklist (physical, later, at the owner's discretion)

1. Identify **two documented, continuously variable CC targets on two different pedals** (an
   expression-style CC with a stated 0–127 sweep). The verified Sunset CC 10/15 do not qualify.
2. On the Live tab bind the real MC8 USB as in the 2026-10-21 record; in the Instrument tab create
   a texture mapping those two CCs with modest ranges and depth; preview first (no sends).
3. Connect (real ports), arm, Start at 60–80 BPM with a long cycle; confirm on the pedals that the
   values move smoothly and in the authored directions; watch the counters stay within 20/s.
4. Stop; confirm nothing follows. Close the tab while performing; confirm the backend stops within
   about five seconds. Unplug USB while performing; confirm disarm and stop.
5. Record results in a dated `docs/live-hardware-validation-<date>.md`, including any pedal that
   steps rather than sweeps (control quantization), and mark the hops `hardware_verified` there.
