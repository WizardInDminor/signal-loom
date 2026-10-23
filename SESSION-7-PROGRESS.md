# Session 7 progress ledger — Morningstar Bridge

Checkpoints for the parallel build. Branch `feature/morningstar-bridge` from `main` `863d5ec`.

## P0 — orientation and baseline

- Read: charter, `backend/app/morningstar/*`, `api/exports.py`, `domain/ml10x.py`, `vendors/morningstar.py`,
  `models/rig.py` (MC8/ML10X models), existing tests, `docs/research.md` + raw notes, the Exports tab,
  the rig page, Team A's branch file list (to avoid their files).
- Toolchain: Python 3.13.16 venv in `backend/.venv`, Node 22.22 / npm 10.9, `npm ci` done.
- Fixtures: `backend/scripts/fetch-fixtures.sh` fetched the two public MC8 editor files (git-ignored).
  The third-party ML10X repository (ragb/ml10x-access-rs, GPL-3.0) was cloned into the session scratchpad
  for local analysis only; nothing from it is vendored.
- Baseline before any edit: `ruff check` + `ruff format --check` clean (98 files);
  `pytest -q` **218 passed, 1 skipped** (ML10X fixture absent).

## Format findings established in P0 (details in docs/morningstar-bridge.md)

- MC8 allBanks fixture inventory: 30 banks × (22 + 4 presets × 16 messages) + `controller_settings`
  (`omniports`, `resistor_ladder_aux`, `controller_settings/general_configurations`, `waveform_engines`,
  `sequencer_engines`, `scroll_counters`, `midi_channels`, `bank_arrangement`, `midi_events`). Observed
  codes: `t` ∈ {0,1,2}, `a` ∈ {0,1,3,5}, `tg` ∈ {0,2}; `d3`, `d4` always 0; `mi` always "".
- ML10X: backup `hash` reproduces with the MC8 Java algorithm (1 sample). `matrixArray[k]` is the
  device's preset segment 48+k (3 presets compared against captures). Non-zero rows coincide with the
  chain's source connectors in the order Input Tip, Input Ring, A Tip, A Ring … E Ring (8/8); the
  one-hot column values are not a function of the target connector alone → undecoded.
