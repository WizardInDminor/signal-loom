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
