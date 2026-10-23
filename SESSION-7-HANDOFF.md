# Session 7 — Engineering Handoff: Morningstar Bridge

Template: [docs/engineering/HANDOFF-TEMPLATE.md](docs/engineering/HANDOFF-TEMPLATE.md). Verification statuses live only in the [Verification Register](docs/verification-register.md) (Session 7 section).

## 1. Assignment and ownership

- **Work package / issue:** Session 7 sprint brief "Morningstar Bridge" (team prompt; no GitHub issue was opened for it). Draft PR [#14](https://github.com/WizardInDminor/signal-loom/pull/14).
- **Team and accountable engineering session:** Team B — Hardware Interoperability (Morningstar native formats). Cloud coding session, this branch only.
- **Base branch and revision:** `main` at `863d5ec` at branch creation; `main` `5502911` (PR #11 Workbench + PR #12 Operating Model) merged in at the integration checkpoint without conflicts.
- **Feature branch / PR:** `feature/morningstar-bridge` → draft PR #14.
- **Problem and intended musician benefit:** a musician who programs an MC8 and an ML10X in the official editors can bring those backups into Signal Loom, see every bank, switch and message in plain language, know exactly which settings Signal Loom understands and which it only preserves, compare the controller's real configuration with the rig's intended scenes, and prepare a reviewed single-bank change without losing anything the file carried.
- **Scope / explicit non-goals:** offline import, inspect, compare, propose. No hardware programming, no SysEx, no firmware, no live sends, no ML10X export, no all-banks output, no decoding of fields without evidence. The official editors remain authoritative.
- **Cross-team dependencies or shared contract approvals:** none required. New modules only; shared `lib/api.ts`, `lib/types.ts`, `models/rig.py`, compiler and workbench untouched. Two one-line registrations (`app/main.py` router include, `layout.tsx` nav link).

## 2. Delivered functionality

- **Working user journey:** top navigation → *Morningstar Bridge* → choose an editor backup → native summary (dump type, date, size, hash check, byte-exactness, unknown keys) → **Inspect** banks → preset grid (page 1 A–H, page 2 I–P, aux-only Q–V, expression presets) → message table with *known* / *third-party name* / *unknown* badges, decoded summary, action, toggle position, raw bytes, anomalies; bank messages and (all-banks files) controller settings with evidence tags; *Unknown data* tab → **Compare with a rig** (pick rig + bank: same / differs / controller only / Signal Loom only) → **Propose changes** (names, flags, PC/CC messages; locked slots) → *Review* (exact field diff, self-check, preserved counts) → download the single-bank file. ML10X: controller settings, 14 connectors with jack labels, 4 × 128 presets, preset detail, routing matrix verbatim marked *undecoded*, *Routing experiment* for export pairs.
- **Changed components/API/schema/file formats:** new `backend/app/morningstar/mc8_native.py`, `ml10x_native.py`, `backend/app/api/morningstar.py` (`GET /api/morningstar/status`, `POST /inspect`, `POST /mc8/compare`, `POST /mc8/propose`, `POST /ml10x/matrix-diff`), `backup_diff.diff_objects`; new `frontend/src/lib/morningstar.ts`, `frontend/src/components/morningstar/*`, route `/morningstar`. No schema or database change; no new file format (output is the existing fixture-validated MC8 `singleBank` shape).
- **Existing behavior preserved (including MIDI/backup boundaries):** the Exports-tab import/inspect/diff routes are unchanged; rig documents are never modified by the bridge; nothing is stored server-side; nothing transmits. Full backend suite and full Playwright suite pass after the merge of `main`.
- **Owner-visible UX decisions and screenshots:** three message classes with one legend everywhere; evidence tags on every setting; locked slots say "preserved verbatim; change it in the official editor"; the proposal repeats the fixture-only evidence level before download. Screenshots: `docs/screenshots/session-7/bridge-1-mc8-inspect-1280.png`, `-2-mc8-compare-1280.png`, `-3-mc8-propose-1280.png`, `-4-ml10x-inspect-1280.png`, `-5-mc8-inspect-390.png`.
- **Deferred capabilities and reasons:** ML10X routing decode and export (undecoded column semantics; F-Q14); all-banks output (would overwrite global settings); editing non-PC/CC messages (semantics unverified); writing a proposal to the controller (hardware write; S7-H01 DEFERRED); importing a proposal into a rig directly from the bridge (the existing Exports-tab import already does this for single-bank files).

## 3. Verification — software

| Test | Environment / command or CI run | Result | Evidence link |
| --- | --- | --- | --- |
| Unit/backend | `backend/.venv` Python 3.13.16 · `ruff check app tests && ruff format --check app tests && python -m pytest -q` | Ruff clean; **see SESSION-7-PROGRESS.md "Verification"** for the pre- and post-merge counts | `backend/tests/test_morningstar_bridge.py` (38 tests) |
| Frontend lint/types/build | Node 22.22 · `npm run lint && npm run typecheck && npm run build` | clean; `/morningstar` prerendered | `SESSION-7-PROGRESS.md` |
| Browser/end-to-end | production build, scratch SQLite, backend :8017 / frontend :3017, `PW_CHROMIUM=/opt/pw-browsers/chromium` · `npx playwright test e2e/morningstar.spec.ts` and full suite | bridge spec 5 passed; full suite passed (counts in the progress ledger) | `frontend/e2e/morningstar.spec.ts` |
| Regression/compatibility/backup | existing suites (MC8 export/import round trip, complete backup, profile collisions, workbench) run unchanged in the same `pytest`/Playwright runs | passed | same runs |
| Visual/mobile/keyboard QA (if UI) | screenshots at 1280 px and 390 px; tabs are buttons with `role=tab`/`aria-selected`, preset grids are `listbox`/`option`, every input labelled; horizontal overflow only inside tables | reviewed | `docs/screenshots/session-7/` |

- **Source commit and test environment:** see the progress ledger for the head SHA at each run; CI on PR #14 is the reference run.
- **Observed errors or skipped tests and explanation:** `test_real_ml10x_backup_hash_and_shape` and the two real-MC8 tests skip in CI because the fixtures are not vendored (public third-party files, one GPL-licensed); they ran locally with the files present.
- **Relevant Verification Register IDs:** S7-S01 … S7-S06 (`SW-PASS`), S7-E01/E02/E03 (`OPEN`), S7-H01 (`DEFERRED`), F-Q14 (`BLOCKED`).
- **Claims not established by these software tests:** that the Morningstar editor accepts a Signal Loom-written file; that a restored bank behaves on an MC8; that third-party message-type names match the editor's labels; any ML10X routing meaning; that name caps beyond the observed maxima are accepted by the editor.

## 4. Safety, data and interoperability review

- **Does any normal action transmit MIDI?** **No.** The bridge has no path to the live service.
- **Hardware writes/configuration changes possible?** **No.** The only output is a downloaded JSON file; applying it is a manual step in the official editor, which the UI tells the user to do into an unused bank after a full backup.
- **Data preservation, exports, restore and backward compatibility:** rig documents, profiles, images, manuals, Scenes and Textures are untouched. The proposal output keeps every key of the input (including unknown top-level, bank, preset and message keys) and every message of an unsupported type; a no-edit single-bank proposal is byte-identical to the input.
- **Unknown or unsupported protocol/file fields:** preserved verbatim and listed (`unknown_keys`, third-party/unknown message classes); editing them is explicitly refused; ML10X routing is preserved as opaque data; ML10X export is blocked.
- **Manufacturer-documented vs user-declared vs owner-observed claims:** every interpreted field carries `sample` (reproduced from real editor files), `documented`, `third_party`, `named` or `unknown`; nothing in this sprint is owner-observed hardware evidence.
- **Potential irreversible actions, hazards or sound-level risks:** none inside Signal Loom. Restoring a file in the official editor overwrites that bank on the controller; the UI and docs require an all-banks backup first and restoring into an unused bank.
- **Safe rollback/revert path and backup required:** revert the PR (no migrations, no data changes). For the owner's controller: the all-banks backup taken before any restore.

## 5. Owner acceptance package (when applicable)

Hardware testing is **N/A for the feature itself** (offline). The one acceptance step that matters is editor-only.

- **Verification claim/ID:** S7-E01 — the Morningstar editor loads a Signal Loom proposal file as a single bank and shows the intended switches.
- **Maturity now:** implemented · SW-validated · integrated after review. Editor-validated: **not yet**. Hardware: **not applicable / DEFERRED (S7-H01)**.
- **Prerequisite equipment, wiring, channel, firmware and software version:** MC8 (original) connected over USB to the computer running the official editor (web or Desktop Editor MKII matching the firmware, 3.13.x assumed); Signal Loom on the PR #14 build; no Signal Loom live connection (Live tab disarmed; release the port if the editor needs it, as in S4-H08).
- **Working backup/restore steps, baseline snapshots and safe audio precautions:** in the editor, *Controller Backup → All Banks*; keep the file. Note which bank is unused (e.g. bank 30). Amp volume down: nothing here makes sound, but a later switch press would send the bank's messages.
- **Test steps:**
  1. In the editor, *Controller Backup → Current Bank* of a bank you use (e.g. bank 1). Save the file.
  2. In Signal Loom, open *Morningstar Bridge*, choose that file. Record: native badges (hash OK / byte-exact / unknown keys count), the coverage line (known / third-party-named / unknown).
  3. Click each used switch in the grid and confirm names and messages match what the editor shows for that bank. Note any slot marked *third-party name* or *unknown* and what the editor calls it (feeds S7-E02).
  4. *Propose changes*: change only the **long name** of one switch (e.g. append " SL"). *Review*: expect "1 field change", "self-check: structure + hash OK". Download.
  5. In the editor, *Restore* the downloaded file as a **single bank into the unused bank** (not the original). Do **not** save to the controller yet.
  6. Open the restored bank in the editor: every switch, message, action and toggle position should equal the original bank except the one long name.
- **Expected observable outcomes:** the editor accepts the file without an error; the restored bank is complete; non-PC/CC messages, if any, are intact.
- **Pass/fail criteria, what to do on partial/failure, stop/disarm and restoration:** PASS = loads + identical except the edited name. PARTIAL = loads but a slot differs (record which; keep the file). FAIL = editor refuses the file (record the message). In all cases nothing was written to the controller; if the editor auto-saved, restore the all-banks backup.
- **What this test does not prove:** that the bank behaves on the MC8 when selected (S7-H01), anything about the ML10X, editor acceptance of files edited in other fields.
- **Evidence to capture:** date, editor version, firmware, the two bank files (private; do not commit), screenshots of the bridge coverage line and the editor's restored bank, owner notes.
- **Hardware test status/limitations and link to dated test report:** **OPEN / not run.**
- **Product acceptance decision by owner:** **pending.**

## 6. Review and release decision

- **CI head SHA / merge status:** PR #14 head after the `main` merge; CI pending at handoff time (see PR checks).
- **Reviewers and outstanding findings:** none yet; draft.
- **Risks accepted explicitly:** fixture-only validation of the output shape; third-party naming of message types; the ML10X row observation is labelled hypothesis and drives no behaviour.
- **Blocked pending hardware vs safe to merge with gated behavior:** safe to merge with S7-E01/E02/E03 open: every unverified claim is labelled in the UI, nothing transmits, nothing writes.
- **Next independent work package proposal and dependencies:** (a) owner runs S7-E01/E02 → fix any editor rejection as a small Team B PR; (b) owner collects S7-E03 pairs → a decoder attempt only once a consistent crosspoint table exists; (c) optional: "import this proposal into the rig" from the bridge, reusing the existing single-bank import route.
- **Merge authorization:** **Owner/reviewer decision required — no autonomous merge.**
