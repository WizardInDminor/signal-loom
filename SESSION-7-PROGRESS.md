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

## P1–P4 — backend: native, interpreted, compare, propose, ML10X, API — commits `52bc6e6`, `69ef541`

- `app/morningstar/mc8_native.py` (load_native / interpret_* / inspect / compare_bank_to_plan / propose),
  `app/morningstar/ml10x_native.py` (load_native / interpret / inspect / matrix_differential),
  `app/api/morningstar.py` (`/api/morningstar/status|inspect|mc8/compare|mc8/propose|ml10x/matrix-diff`),
  `backup_diff.diff_objects`, router registered in `main.py` (one line).
- Decisions: stateless request-scoped API (no tables, no stored files, rig untouched); singleBank is the
  only output; an allBanks bank can be lifted verbatim; edits are allow-listed and validated, locked slots
  (non PC/CC) refuse edits; unknown keys at every level ride along; clean empty slots are compacted in the
  report (6.5 MB → 1.5 MB for the real all-banks file).
- Tests `tests/test_morningstar_bridge.py` (38): unknown-key preservation, message classification without
  invented meaning, allBanks controller settings, six parse-failure shapes, version/shape discrepancies,
  byte-identical no-edit proposal, ten applied edits with exact diff + fresh hash + preserved foreign slots,
  fourteen refused edits, allBanks bank lift, compare (same / differs / only-native / order), real MC8
  fixtures lossless and fully known, real ML10X hash (skipped without the file), ML10X synthetic
  native/interpretation, shape warnings, matrix differential, API status/inspect/compare/propose/matrix-diff.

## P5–P6 — frontend workspace and e2e — commit `6d46668`

- `frontend/src/lib/morningstar.ts` (types + client), `components/morningstar/{MorningstarBridge,
  Mc8Inspector, Mc8Compare, Mc8Propose, Ml10xInspector, bits}.tsx`, route `app/morningstar/page.tsx`,
  one nav link in `layout.tsx`. No change to `lib/api.ts`, `lib/types.ts` or any Team A component.
- Browser inspection (production build, scratch DB, ports 8017/3017) at 1280 px and 390 px:
  `docs/screenshots/session-7/bridge-{1..5}-*.png`.
- `frontend/e2e/morningstar.spec.ts` (5): inspect with known/third-party/unknown told apart and unknown
  keys listed; compare identical then drifted (differs / controller only / not modelled); propose with
  byte-identical no-edit review, three edits reviewed as a 5-field diff, downloaded file verified
  (singleBank, hash recomputed, foreign slot untouched), refused edit produces no file; ML10X inspect
  (hash OK, unknown key, undecoded routing with hypothesis labels, factory preset, connectors) and the
  routing experiment; a deviceModel-8 file and garbage kept opaque with problems shown.

## Verification (final, on the PR head)

| Check | Command | Result |
|---|---|---|
| Backend lint | `ruff check app tests && ruff format --check app tests` | clean (102 files) |
| Backend tests | `python -m pytest -q` | **256 passed** (218 baseline + 38 new; the ML10X fixture test runs locally with the third-party file copied in, and skips in CI) |
| Frontend | `npm run lint && npm run typecheck && npm run build` | clean; `/morningstar` prerendered |
| Bridge e2e | `E2E_BASE_URL=http://localhost:3017 PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test e2e/morningstar.spec.ts` | **5 passed** |
| Full e2e | `… npx playwright test` (production build, scratch DB) | **53 passed** in 2.2 min (48 existing + 5 bridge) |

Not achieved (by design of the charter): loading a Signal Loom-written file into the Morningstar
editor or an MC8; decoding the ML10X routing matrix; any ML10X native export; any hardware interaction.

## Integration checkpoint — `main` 5502911 merged (PR #11 Workbench, PR #12 Operating Model)

- `git merge origin/main` into `feature/morningstar-bridge` → merge commit `ecad98c`, **no conflicts**
  (Team A's files and the bridge's files are disjoint; `layout.tsx` carries both nav changes).
- Read root `CLAUDE.md`, `docs/engineering/OPERATING-MODEL.md`, `docs/engineering/HANDOFF-TEMPLATE.md`,
  `docs/verification-register.md`. Adopted for the rest of the sprint: Team B ownership boundary
  (Morningstar native formats), handoff document with all six sections, verification IDs with
  `SW-PASS` only for software evidence, editor acceptance kept separate from device acceptance,
  no autonomous merge.
- Added: `SESSION-7-HANDOFF.md` (linked from PR #14), Verification Register section "Session 7"
  (S7-S01…S06 `SW-PASS`, S7-E01…E03 `OPEN`, S7-H01 `DEFERRED`, F-Q14 `BLOCKED`).
- Plan changes: none to the deliverables. Documentation deliverables extended by the handoff and the
  register entries; `SESSION-7-PLAN.md` amended accordingly.

### Re-verification on the merged tree (head `ecad98c` + docs)

| Check | Command | Result |
|---|---|---|
| Backend lint | `ruff check app tests && ruff format --check app tests` | clean |
| Backend tests | `python -m pytest -q` | **270 passed** (256 before the merge + Team A's 14) |
| Frontend | `npm ci && npm run lint && npm run typecheck && npm run build` | clean; `/morningstar` and `/catalog/[id]/workbench` both build |
| Full e2e | production build, scratch DB, :8017/:3017, `npx playwright test` | **57 passed** in 2.3 min (48 existing + 5 bridge + 4 workbench) |

## Review checkpoint — proposal gate corrections (commit `747a7de`)

Team B review asked for three corrections to `mc8_native.propose`, applied without new features and
without touching the ML10X export prohibition:

1. A missing or mismatched integrity hash now refuses the proposal with a diagnostic (no re-hashing of
   an unverifiable input). Inspection and compare of such files stay available.
2. A `schemaVersion` other than the fixture-validated 1 refuses the proposal instead of being rewritten.
3. `preserved.byte_identical_to_input` compares the actual output text with the input text.

The proposal panel shows the refusal up front and disables *Review*. Regression tests: three backend
cases, one API 422 case, one browser case. Docs: handoff §2/§4/§6, bridge doc §1/§4, register S7-S07.

| Check | Command | Result |
|---|---|---|
| Backend lint + tests | `ruff check/format --check` · `pytest -q` | clean · **273 passed** (+3) |
| Frontend | `npm run lint && npm run typecheck`; production build for e2e | clean |
| Bridge e2e | `npx playwright test e2e/morningstar.spec.ts` (scratch DB, :8017/:3017) | **6 passed** (+1) |

## Second integration checkpoint — `main` 34d528f merged (PR #13 Library Search, PR #15 Instrument Studio)

- Merge commit `d45e9b5`; one conflict in `docs/verification-register.md` (Team A updated F-Q11/F-Q12 in the
  same table where F-Q14 was added) → kept Team A's rows, appended F-Q14. No code conflicts.
- **Mobile header overflow, root cause measured** (Playwright, 390 px, production build): the `<nav>` had
  `white-space: nowrap` / `flex-wrap: nowrap` from PR #11; with the Morningstar Bridge link the nav's right
  edge was at **391 px** (links: Rigs 28 px, Device library 87 px, Morningstar Bridge 123 px) → document
  scroll width 391 px, at the ±1 px tolerance of the `images.spec.ts` / `instrument.spec.ts` phone
  assertions and font-dependent in CI. Fix: nav `flex flex-wrap gap-x-3 gap-y-0.5 sm:gap-4 min-w-0`,
  each link `whitespace-nowrap`. After: header scroll width **390 px**, third link wraps to row two
  (`docs/screenshots/session-7/bridge-6-header-390-wrapped.png`). No overflow hidden, no test changed.
- Pre-existing, out of scope: `/` (Rigs library) main content is 468 px wide at 390 px before and after
  the fix; not covered by a test; left for Team A.

| Check | Command | Result |
|---|---|---|
| Backend lint + tests | `ruff check/format --check` · `pytest -q` | clean · **273 passed** |
| Frontend | `npm ci && npm run lint && npm run typecheck && npm run build` | clean |
| Full e2e | production build, scratch DB, :8017/:3017, `npx playwright test` | **65 passed** in 2.4 min, 0 failed (incl. the `images.spec.ts` and `instrument.spec.ts` phone-width cases) |
