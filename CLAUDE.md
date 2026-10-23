# Signal Loom — Instructions for Engineering Agents

Signal Loom is a **local-first, musician-first creative instrument that understands a real pedalboard**. Musical intent and exploration lead the UX; rigorous physical topology, documented capabilities and recoverable configuration make it trustworthy.

## First steps in every new session

1. Read [Engineering Operating Model](docs/engineering/OPERATING-MODEL.md) **before planning or editing**.
2. Read [README](README.md) for current setup/test commands, [Architecture](ARCHITECTURE.md) for implemented design, and [Creative Instrument Vision](docs/creative-instrument-vision.md) for product direction.
3. Read [Verification Register](docs/verification-register.md) and relevant dated hardware reports before making any hardware-related claim. Read [Research](docs/research.md) for protocol evidence.
4. Confirm the assigned team, scope, branch, worktree/environment isolation, current `main`, and active related PRs. Do not assume the most recent session transcript is the source of truth.
5. Establish a passing baseline and document a concise implementation/design plan for substantial work.

## Standing engineering rules

- **One active implementation PR per team.** Start feature work from current `main` in an isolated branch/worktree/cloud session. Never modify another team's worktree or branch. Never merge automatically.
- **Ownership:** Team A = product experience, device knowledge and Instrument Studio; Team B = Morningstar interoperability, controller-native formats and their adapters. Shared schema/API/compiler changes require explicit cross-team coordination; do not silently expand scope.
- Preserve project/rig data, pedal images, manuals, model/instance identity, Scenes, Textures, backups and restore behavior. Add regression tests whenever touching their boundaries.
- **Default to offline, non-transmitting behavior.** No new live sends, SysEx, preset writes, firmware changes, or speculative hardware actions without separately approved scope and guarded validation.
- Distinguish **manufacturer-documented**, **user-declared**, **software/virtual-tested**, **last-commanded**, and **owner-observed hardware-verified**. These are not synonyms. Never promote a test fixture or outbound MIDI log to a physical-device claim.
- Preserve unknown native-file fields or explicitly refuse unsafe modification/export. Never silently drop settings or invent file-format semantics.
- Treat browser screenshots and user journeys as part of UI acceptance, alongside lint, tests and build. Respect `frontend/AGENTS.md` when working in Next.js.
- Deliver the [Engineering Handoff](docs/engineering/HANDOFF-TEMPLATE.md) in every substantive PR. Document limitations, failure/recovery conditions, and pending owner acceptance.
- Maintain [Verification Register](docs/verification-register.md) as the **single canonical status index** for test claims; put observations in dated hardware reports and link them. Passing CI is `SW-PASS`, not `HW-PASS`.
- A software-complete PR may merge with physical tests outstanding if unverified behavior stays honestly labeled and safely gated. Merge does not imply product acceptance.

## Documentation roles

- `CLAUDE.md`: short standing onboarding instructions, not a sprint log.
- `docs/engineering/OPERATING-MODEL.md`: team process, gates, responsibility and conflict management.
- `docs/engineering/HANDOFF-TEMPLATE.md`: repeatable completion and acceptance handoff.
- `docs/verification-register.md`: live verification statuses and evidence links.
- `docs/future-features.md`: ideas and deferred requests; **not** implementation authorization.
- PRs and GitHub Issues: active assignments, changes, ownership and review decisions.
