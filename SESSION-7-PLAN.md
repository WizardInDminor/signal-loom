# Session 7 — Morningstar Bridge: implementation plan

Branch `feature/morningstar-bridge`, created from `main` at `863d5ec`. Runs in parallel with Team A
(PR #11, MIDI Knowledge Workbench on `feature/midi-knowledge-workbench`); nothing from that branch is
merged, cherry-picked or edited here. Files Team A touches (`lib/api.ts`, `lib/types.ts`,
`models/rig.py`, `domain/compiler.py`, `exports/project.py`, `api/catalog.py`, the workbench
components) are left alone except for one navigation link in `layout.tsx` and one router
registration in `main.py`.

## Mission (from the charter)

Import, understand, compare and (where already validated) export native Morningstar MC8 and ML10X
editor backup files, without replacing the official editors. Three layers are kept apart:

| Layer | What it is | Where it lives |
|---|---|---|
| **Native snapshot** | The file exactly as the editor wrote it: parsed JSON kept whole, byte-exactness and integrity hash checked, every unknown key or code preserved and listed. | `morningstar/mc8_native.py::load_native`, `morningstar/ml10x_native.py::load_native` |
| **Interpreted configuration** | Signal Loom's reading of the fields whose meaning is established, each tagged with an evidence level (`sample`, `documented`, `third_party`, `unknown`). Nothing is dropped: a message of an unsupported type is still shown, with its raw bytes. | `interpret_*` functions in the same modules |
| **Proposed modification** | Deliberate edits to known fields of a native snapshot, applied to a copy of the raw data, with a reviewable diff against the original before any file is produced. Unknown and unsupported content rides along verbatim. | `mc8_native.py::propose` + `backup_diff` |

## Evidence rules

- MC8: shape, codes 0/1/2, `hash` = Java `String.hashCode` over compact `data` JSON: **fixture-validated**
  on three real editor files (not vendored; `backend/scripts/fetch-fixtures.sh`). Message type codes
  beyond 0/1/2 and action codes 6–8 come from the MC8 Pro SDK (**third-party**): shown by name, never
  emitted by the compiler, preserved verbatim by the bridge.
- ML10X: shape from one real `dumpType: full` backup (GPL-licensed third-party repository, analysed
  locally, not vendored). New in this session: its `hash` is the same Java algorithm (**1 real sample**),
  and the routing `matrixArray` equals the device's SysEx segments 48–63 byte for byte (3 presets,
  third-party captures). The matrix column semantics stay **undecoded**; routing is preserved as opaque
  native data and the UI says so. No ML10X file is written.
- Native output: MC8 `singleBank` files only (the already validated writer). An `allBanks` input can
  have one bank lifted verbatim into a `singleBank` file. No `allBanks` output, no SysEx, no hardware.

## Work packages

1. **P1 backend — MC8 native + interpretation**: `mc8_native.py` (load, interpret banks / switch presets /
   expression presets / bank messages / controller settings, coverage summary), unit tests on synthetic
   files and the real fixtures (skipped when absent).
2. **P2 backend — compare + propose**: compare a native bank with the rig's compiled MC8 plan (modeled
   intent) position by position; propose edits on an allow-list of known fields, produce the diff and a
   self-checked `singleBank` file.
3. **P3 backend — ML10X**: `ml10x_native.py` (load with hash check, interpret controller/connectors/presets,
   matrix kept opaque with row observations), matrix differential helper for controlled export pairs.
4. **P4 API**: `api/morningstar.py` (`/api/morningstar/...`), stateless, request-scoped; registered in
   `main.py`.
5. **P5 frontend — Morningstar Bridge workspace** at `/morningstar`: load a backup (auto-detect model),
   inspect banks → presets → messages with known/third-party/unknown badges, compare against a rig bank,
   propose edits with a review diff and download, ML10X controller/connector/preset views with the raw
   matrix. Own API module (`lib/morningstar.ts`), own components (`components/morningstar/`).
6. **P6 verification**: Ruff, pytest, ESLint, tsc, Next build, Playwright spec `e2e/morningstar.spec.ts`.
7. **P7 docs + PR**: `docs/morningstar-bridge.md` (architecture decisions, format findings, limitations,
   test evidence), README/ARCHITECTURE pointers, `docs/research.md` findings, `SESSION-7-PROGRESS.md`
   ledger, draft PR. Private backups, serials and user configurations are never committed.

## Amendment — integration checkpoint (main 5502911)

The Engineering Operating Model (PR #12) and Team A's Workbench (PR #11) were merged into `main`
mid-sprint and incorporated into this branch without conflicts. Deliverables are unchanged. Added to
package 7: an [Engineering Handoff](SESSION-7-HANDOFF.md) following `docs/engineering/HANDOFF-TEMPLATE.md`,
Session 7 entries in `docs/verification-register.md` (software claims as `SW-PASS`, editor acceptance
as `OPEN`, controller write as `DEFERRED`, ML10X export as `BLOCKED`), and the PR description reduced
to a summary that links the handoff (one canonical copy). Ownership: this is Team B work (Morningstar
interoperability); no shared contract was changed.
