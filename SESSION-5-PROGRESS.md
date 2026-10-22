# Session 5 progress ledger

Durable checkpoints for the autonomous build (charter §8). Each gate records the branch SHA, what
was done, the exact commands and results, open issues and the next action. If the session is
compacted or restarted: re-read SESSION-5-CHARTER.md, SESSION-5-DIRECTION.md, this file and
`git log`, then resume from the last checkpoint rather than redesigning.

## P0 — orientation, baseline and design

- Branch `experiment/session-5-creative-instrument` created from `main` at `530f413`
  (`git merge-base --is-ancestor ef07632 HEAD` → PR #4 merge is an ancestor; working tree clean).
- Read: charter, creative vision, README, ARCHITECTURE, Session 4 charter/results, the 2026-10-21
  hardware record, Session 3 direction/freestyle, future features, and the live/model/API/store code.
- Toolchain: Python 3.13.16, Node 22.22, npm 10.9. `python-rtmidi` is not installed (virtual
  transport only, as in CI). Playwright 1.64 wants Chromium 1248 but only 1194 is pre-installed, so
  the suite runs with `PW_CHROMIUM=/opt/pw-browsers/chromium` (the config already honours it); CI
  installs its own browser and is unaffected.
- Baseline (before any edit):

| Check | Command | Result |
|---|---|---|
| Backend lint | `ruff check app tests && ruff format --check app tests` | clean (81 files) |
| Backend tests | `python -m pytest -q` | **147 passed, 4 skipped** (external MC8/ML10X fixtures) |
| Frontend | `npm run lint && npm run typecheck && npm run build` | clean |
| Playwright | `PW_CHROMIUM=/opt/pw-browsers/chromium npm run test:e2e` (prod build, scratch DB) | see below |

- Design written to SESSION-5-DIRECTION.md (schema, eligibility, evaluator, engine, lease, budgets,
  UI, virtual fixture). Decisions worth flagging: the virtual fixture is an on-demand rig template,
  not an auto-seeded rig (keeps the seed/cold-start tests and existing e2e rig counts untouched);
  while performing, auditions and panel sends are refused (one deterministic rule); Stop is open to
  any local client while params/heartbeat need the controller id.
- Next: P1 — models, migration, repo, export/import, validation, synthetic profiles and template,
  static Instrument UI.

| Playwright baseline | 43 passed (52.7 s), production build, scratch DB, `PW_CHROMIUM=/opt/pw-browsers/chromium` | |

P0 commit: `84b35f9` (direction + ledger).

## P1 — persistent Texture model (backend) — commit `b3ac305`

- `models/texture.py` (Texture / Macro / Mapping / Lfo, bounds, override-needs-note), `Rig.textures`,
  migration `0006_textures.sql`, repo read/write, `project_dict` omits an empty `textures` key,
  PUT validates unique texture ids, `POST /api/rigs {template: "virtual_instrument"}`.
- `CcDef.continuous` (None by default); BigSky MX CC 100 marked continuous (documented expression
  sweep); two synthetic profiles `signal-loom-virtual-pedal-a/b` (`provenance.source =
  synthetic_fixture`, CC 21/22 continuous, CC 60 synthetic bypass not eligible).
- `instrument/evaluator.py` (pure math), `instrument/eligibility.py`, `instrument/diagnostics.py`
  (`texture.scene_missing`, `texture.instance_missing`, `texture.mapping_ineligible`,
  `texture.mapping_user_declared`; `analysis.textures` report with values at macro 0/½/1).
- Tests: `test_instrument_evaluator.py` (9), `test_instrument_eligibility.py` (6),
  `test_instrument_model.py` (6; legacy DB without the table, round trip, restart, export omission,
  dangling refs, template). `pytest -q`: **174 passed, 4 skipped**; Ruff clean.

## P3 (backend first) — performance engine, sender streaming, service and API

- `live/sender.py`: `open_stream` / `stream_one` (coalesced, quiet, refused once the job ended) /
  `cancel_job` (control call: waits for in-flight) / `on_disarm` hooks / `pending_discrete`.
- `live/performance.py`: `PerformanceEngine` with `Clock` abstraction (`RealClock`, `FakeClock`),
  states idle/performing/stopped/fault, lease (5 s, heartbeat), 100 ms tick, 2 handoffs per tick
  aggregate and 1 per destination, dedup, deferred (never queued), round-robin, phase freeze on
  tempo/division change, Stop that joins the thread, disarm hook → stop before the next message.
- `live/service.py`: `texture_readiness`, `start_performance` (structural blockers → then route
  acknowledgements → then start), `stop_performance` (no controller needed), heartbeat, params;
  auditions/panel sends refused with `409 live.performing`; status carries `performance`.
- `vendors/__init__.py`: a synthetic fixture's reception is `supported / simulation_tested`.
- `api/live.py`: readiness, start, `/perform/stop|heartbeat|params|status` (loopback-only).
- Tests: `test_performance_engine.py` (14, fake clock / blocking / failing transports),
  `test_instrument_api.py` (5). `pytest -q`: **193 passed, 4 skipped**; Ruff clean.
- Next: frontend (types, API, evaluator mirror, performance store, Instrument tab), then P4 e2e.

## P1 (frontend) + P2 + P4 — Instrument workspace, journey, review — commit `a70c6ee` and after

- Frontend: `types.ts` (Texture/Macro/Mapping/Lfo, TextureReport, PerformanceStatus, Readiness),
  `api.ts` (readiness/start/stop/heartbeat/params), `lib/instrument.ts` (evaluator mirror + function
  lens), `store/instrumentStore.ts`, rig-store texture helpers, `components/instrument/*`
  (InstrumentTab, TextureHeader, PatchBay, PerformancePanel, usePreviewClock), page wiring
  (Instrument first tab, PERFORMING badge, heartbeat owned by the page), rig-library template,
  reduced-motion CSS.
- Browser inspection (production build, scratch DB) at 1280 px and 390 px: preview / armed /
  performing / stopped screenshots captured and read; fixes made from them: Connect binds the
  simulated USB in virtual mode; destination table scroll and column order; header wrap at phone
  width; stop reason from backend status; heartbeat moved from the tab to the page.
- Adversarial review of sender/engine/persistence (see SESSION-5-RESULTS.md); one engine refinement
  (a disarm racing a tick keeps the disarm reason). Backend `pytest -q`: 193 passed, 4 skipped.
- `e2e/instrument.spec.ts` (4 scenarios) green alone; the first full run found a cross-file
  interference on the single live service (two workers) → `workers: 1` in the Playwright config;
  full suite rerun pending at this checkpoint.
- Docs: README and ARCHITECTURE sections, `docs/future-features.md` backlog entry, results draft.
- Next: full suite result → screenshots into `docs/screenshots/session-5/` → final numbers in the
  results → push → draft PR → CI on the final head.

## P4 checkpoint — full suite green locally, screenshots, PR

- Full Playwright on the final frontend build with a fresh backend database and one worker:
  **47 passed (1.8 m)**; backend **193 passed, 4 skipped**; Ruff, lint, typecheck, build clean.
- `docs/screenshots/session-5/` captured from the production build (preview / armed / performing /
  phone performing / phone stopped) and inspected.
- Branch pushed; draft PR opened against `main` (title "Session 5: First Playable Whole-Rig
  Instrument"). Next: wait for GitHub Actions on the PR head, fix anything it finds, record the
  final run here.

## CI on the PR head

- Draft PR: https://github.com/WizardInDminor/signal-loom/pull/7 (base `main`, unmerged).
- GitHub Actions run 38 on head `29ead65`: https://github.com/WizardInDminor/signal-loom/actions/runs/39732286095
  — **backend ✓ (ruff check, ruff format --check, pytest), frontend ✓ (lint, typecheck, build),
  e2e ✓ (Playwright on a fresh database)**, conclusion `success`, 3.5 min end to end.
- This ledger entry is the last commit; its own CI run on the final head is linked from the PR
  checks and in the handoff.
