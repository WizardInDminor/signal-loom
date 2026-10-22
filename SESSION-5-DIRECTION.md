# Session 5 direction — the first playable whole-rig instrument

**Branch:** `experiment/session-5-creative-instrument` · **Baseline:** `main` at 530f413 (PR #4 merged at
ef07632 is an ancestor; the Session 5 charter commit on top). Baseline checks before any edit: backend
147 passed / 4 skipped, Ruff clean, frontend lint/typecheck/build clean, Playwright 43 (see
SESSION-5-PROGRESS.md for the exact run).

This file says *how* the charter's vertical slice is built on the Session 4 foundation and which
tradeoffs were taken. It is written before the implementation and kept short on purpose.

## The one experience

A guitarist opens a rig, picks **Instrument**, and sees a named **Texture** ("Undertow"): what it is
musically, which starting Scene it assumes, its tempo, one large **Bloom** macro, and the two pedal
controls that macro moves — one up, one down — with a slow tempo-related triangle LFO breathing on
top. Moving the macro shows the exact seven-bit value each destination *would* receive; nothing is
sent. Connecting the virtual transport, arming (Session 4's phrase) and then pressing **Start
performance** streams those values to the simulated pedals under a documented budget, with a
heartbeat lease that stops the stream when the browser goes away. Stop halts it; the idea is saved
with the rig and comes back identical after a reload, a duplicate or an export/import.

## Data model (additive; `backend/app/models/texture.py`, mirrored in `frontend/src/lib/types.ts`)

```
Rig.textures: list[Texture]                      # new, default []; older rigs load with none
Texture      id tex_* · name · intent · notes · base_scene_id? · tempo_bpm (20–300) ·
             macros: list[Macro] · function_roles: {instance_id: role} · created_at · updated_at ·
             origin ("user" | "virtual_fixture")
Macro        id macro_* · name · base ∈ [0,1] · mappings: list[Mapping] · lfo: Lfo
Mapping      id map_* · instance_id · cc (0–127) · output_min/max (0–127; min > max = inverse) ·
             label? · enabled · user_override (bool) · override_note? · control_name? (display only)
Lfo          enabled · shape "triangle" · beats_per_cycle (0.25–64) · depth ∈ [0,1]
```

- Persistence: a new child table `textures` (migration `0006_textures.sql`, `(rig_id, id)` key,
  JSON data, cascade with the rig) synced like scenes by `RigRepository`. Nothing in the existing
  tables changes; an older database simply has an empty table.
- Project files: `textures` travels inside `rig` as ordinary JSON; `project_dict` omits the key
  when it is empty so a plain export of a rig without textures stays readable by the previous app
  version (same rule as `documents`). Duplicate and import keep ids, so a mapping's `instance_id`
  and a texture's `base_scene_id` still point at the same copied devices/scenes.
- Validation on `PUT /api/rigs/{id}`: unique texture/macro/mapping ids. Dangling references (a
  mapping's instance gone, a base scene gone) are **not** rejected and never retargeted: the
  analysis reports them as `texture.instance_missing` / `texture.scene_missing` warnings and the
  readiness endpoint marks the mapping not eligible, so the user repairs it deliberately.
- Runtime (phase, lease, counters, last-commanded values) lives only in the backend engine and
  is never written into the rig document.

## Eligibility: which CCs may be swept (`backend/app/instrument/eligibility.py`)

A CC on a device is *eligible for continuous modulation* only when:

1. the instance exists, has a profile and a MIDI channel 1–16;
2. the CC is not 0/32 (bank select), not 120–127 (channel mode), not the profile's bypass CC, not
   a documented bypass/engage pair, toggle or bank-select semantics, and not a `MidiCommand` with
   intent engage/bypass/toggle/recall;
3. **and** either the profile documents it as continuous — a new optional `CcDef.continuous: bool |
   None` (None = unknown, the default for every existing profile, so nothing is promoted) — or the
   mapping carries `user_override = True` with a non-empty `override_note` (the user's claim,
   shown with a warning and `user` provenance).

The result carries a `basis`: `documented` (continuous = True on a real profile), `synthetic`
(continuous = True on a profile whose `provenance.source == "synthetic_fixture"`), `user_declared`,
or a refusal reason. Among the shipped profiles only BigSky MX CC 100 ("Expression, 0 heel – 127
toe", documented) is marked continuous; Sunset CC 100 stays unknown (its evidence is unknown). The
physically verified Sunset CC 10/15 are bypass controls and are refused.

## Pure evaluator (`backend/app/instrument/evaluator.py`, mirror `frontend/src/lib/instrument.ts`)

- `period_s = beats_per_cycle × 60 / bpm`; phase `φ = ((t − t0) / period + φ0) mod 1`.
- Triangle `l(φ)`: `l(0)=0` rising, `l(0.25)=1`, `l(0.5)=0`, `l(0.75)=−1`, `l(1)=0`. Starting at 0
  means enabling the LFO never jumps away from the macro's base value.
- `e = clamp(b + d·l, 0, 1)`; LFO disabled → `e = b`.
- Each destination: `clamp(round_half_up(min + (max − min)·e), 0, 127)` with `round_half_up(x) =
  floor(x + 0.5)` in one tested function; reversed min/max gives the inverse gesture.
- NaN/∞, BPM/division/depth outside bounds and bad CCs raise `EvaluationError`.
- Tempo change while running: the engine freezes the current phase as the new `φ0` at the new
  `t0`, so the waveform continues from where it was; no catch-up burst is possible because nothing
  is ever queued ahead of time (see below).

The TypeScript mirror drives the on-screen animation and preview; the backend is authoritative and
the readiness endpoint returns the backend's values at macro 0 / 0.5 / 1 so the UI's numbers are
the server's.

## Performance engine (`backend/app/live/performance.py`)

One `PerformanceEngine` per `LiveService`, built disarmed and idle on every process start.

- **States:** `idle` (preview only), `performing`, `stopped` (with the reason), `fault` (a send
  failed or a safety hook fired). "Armed but not performing" is `idle` with `sender.armed = True`;
  arming alone never starts anything.
- **Start** (`POST /api/live/rigs/{rig}/textures/{tex}/start`) requires, in this order: loopback
  client; rig connected; sender armed; no audition/panel job pending; no performance running;
  texture found; ≥1 enabled, eligible mapping; every mapping resolved to an *open* output endpoint
  whose CC route is supported/unverified and whose prerequisites/unverified hops are acknowledged
  (the Session 4 `live.confirm_route` flow, same strings). Any refusal happens before anything is
  queued. Start returns a fresh `controller_id`.
- **Lease:** the controller heartbeats (`POST /api/live/perform/heartbeat`, every 1.5 s from the
  browser) and the engine expires the lease 5 s after the last one (`SIGNAL_LOOM_PERFORM_LEASE_S`).
  Expiry stops the stream even though the backend stays armed. Parameter changes
  (`/perform/params`: macro base, LFO depth/enabled/division, BPM) need the controller id; **Stop
  needs nothing** — any local client may stop. A second tab sees the performance and may stop it,
  but cannot take it over without stopping first.
- **Tick loop:** a worker thread on a `Clock` abstraction (`monotonic()`, `wait(timeout)`; tests
  inject a fake clock and step it). Every 100 ms it evaluates every mapping, compares with the last
  value *handed to the sender* per `(instance, cc)` and skips unchanged values (dedup). Changed
  values go to `LiveSender.stream_one` — the Session 4 sender, coalesced per device/CC, quiet
  (no "queued" log entry, one long-lived job per performance), so the sender's lock, in-flight
  semantics, armed check and route check apply to every message. Budget: at most 2 handoffs per
  tick (20 msg/s aggregate) and one per destination per tick (10 msg/s per destination); when more
  than two destinations change in one tick the surplus is *not queued* — it is counted as
  `deferred` and recomputed next tick from the newest value (round-robin start so no destination
  starves). The sender queue therefore never holds more than one message per destination.
- **Stop paths** (all cancel the performance's queued messages and let the one in-flight message
  finish): Stop button; lease expiry; `LiveSender` disarm for any reason (user, bindings change,
  transport change, lost/ambiguous endpoint, enumeration failure, transport error, shutdown) via an
  `on_disarm` hook the sender calls inside its disarm critical section; service disconnect, mode
  switch, rig switch, release. After `stop()` returns the tick thread has exited and no further
  message can be handed to the transport; this is proven with a transport that blocks inside
  `send`.
- **Competing streams rule:** while performing, scene auditions and panel sends are refused with
  `409 live.performing` ("stop the performance first"); Start is refused while any audition/panel
  message is pending. Deterministic, no racing streams.
- **Status** (`/api/live/status.performance`, polled with the rest): state, texture, controller
  present, lease remaining, started/stopped at, reason, counters (`evaluations`, `planned`,
  `handed_to_sender`, `deduplicated`, `deferred`, `failed`, `cancelled`), current phase / LFO /
  effective value per macro and the last commanded value per mapping (clearly "last commanded",
  not pedal state).

## Virtual fixture

Two synthetic builtin profiles, `signal-loom-virtual-pedal-a` and `-b` ("Signal Loom Virtual Texture
Pedal A/B", `provenance.source = "synthetic_fixture"`, USB MIDI, CC 21 "Synthetic sweep A" and CC 22
"Synthetic sweep B" marked `continuous = True`, plus a synthetic bypass CC that is *not* eligible),
and an on-demand rig template `POST /api/rigs {template: "virtual_instrument"}` ("Undertow demo
(virtual instrument)") with the two pedals on channels 1 and 2, a guitar, an amp, one starting Scene
and the **Undertow** texture: Bloom → Pedal A CC 21 100→30 and Pedal B CC 22 15→110, 72 BPM,
triangle over 8 beats, depth 0.25. These are test-fixture numbers, not statements about any real
pedal, and every surface labels them synthetic. The fixture is not seeded automatically; the
Instrument tab offers it when the current rig has no eligible destination, and the rig library
offers it as a template.

## UI (`frontend/src/components/instrument/`, store `instrumentStore.ts`)

A new first tab **Instrument** (`#instrument`; the default tab stays Board so existing deep links and
tests are unchanged):

1. *What am I playing?* — texture list (new / duplicate / rename / delete), name, intent, notes,
   base Scene, BPM, and the large Bloom macro (range input, keyboard-operable, with the effective
   value and the LFO phase drawn beside it).
2. *What does it move?* — the rig grouped by function (drive · dynamics · pitch · modulation ·
   delay · space · routing · other; defaults from profile tags, editable per texture), each device
   with its channel and CC route status, and the patch list: macro → destination with range,
   direction arrow, the three values at macro 0 / 0.5 / 1, eligibility basis, synthetic badge and
   route/acknowledgement state; add/remove/edit mappings, user override with a required note.
3. *What is happening?* — state badge PREVIEW / DISARMED / ARMED / PERFORMING / STOPPED, transport
   (virtual vs real), connect / arm (phrase) / **Start performance** / **Stop**, counters, per
   destination the effective seven-bit value and the last commanded value, the lease indicator, and
   an honest "not yet controllable" state with the reasons when the rig has fewer than two eligible
   destinations. Animation uses the TS evaluator on `requestAnimationFrame` and is static under
   `prefers-reduced-motion`; the numbers are always printed.

Editing a texture is an ordinary `useRigStore.update` (revision bump, undo, debounced PUT, stale
revision rule). Structural edits (mappings) are disabled while performing; macro/LFO/BPM changes
while performing go to the engine *and* to the document (debounced), so the saved idea follows
the gesture without saving every tick.

## Not built (deliberately)

Multiple modulation sources or summing, envelopes/steps, Movement/Transition objects, Experiment
Lab, MIDI Clock out, SysEx, MIDI learn/expression input, browser Web MIDI, real-hardware claims.
Seams left: `Lfo.shape` is a literal with one value; the engine evaluates a `Texture` and knows
nothing about scenes; eligibility is a pure function profiles can feed with more `continuous`
facts as they are documented or verified.
