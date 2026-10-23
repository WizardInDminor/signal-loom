# Signal Loom — Engineering Operating Model

**Status:** Standing project process • **Owner:** Product owner • **Applies to:** human contributors and all coding agents • **Change control:** reviewed PR to `main`

This document governs *how* Signal Loom work is assigned, built, integrated, tested and accepted. For *what* to build, follow the [Creative Instrument Vision](../creative-instrument-vision.md), the current assigned GitHub Issue/PR and approved sprint brief. For *what is proven*, consult the [Verification Register](../verification-register.md). These sources must not contradict one another; stop and surface discrepancies.

## 1. Why this process exists

Keep independent engineering work flowing when the physical pedalboard is unavailable, without confusing CI, simulated MIDI, real hardware observations or a musician's acceptance. Build a creative environment that understands the real rig while preserving existing settings, provenance and recovery paths.

**Development, integration and hardware validation are distinct workloads.** A software merge can precede a physical test, but does not claim that the feature works with untested equipment. Product acceptance is a further user-experience decision.

## 2. Roles and ownership

| Role | Owns | Must not silently change |
| --- | --- | --- |
| Product owner | Product priorities, acceptable tradeoffs, physical rig configuration, owner hardware observations, go/no-go for risky actions and acceptance | Delegated implementation details unnecessarily |
| Engineering Team A — Product Experience | Instrument Studio, musician UX, Device Library/knowledge workflow, visual QA, usability regression tests | Morningstar native codecs, controller firmware assumptions, live MIDI transport |
| Engineering Team B — Hardware Interoperability | MC8/ML10X native file import/inspection/diff/export, format evidence, controller-adapter tests | Instrument Studio redesign, Device Library UX, live MIDI engine |
| Integration/review function | Cross-boundary architectural review, CI/PR verification, verification debt, merge order, conflict adjudication | Inventing hardware observations or silently accepting untested behavior |
| Owner hardware validation | Executes safe, preplanned physical tests; records observed responses, failures, restoration and workflow quality | Treating a command sent/logged as device readback |

These are **workstream ownership boundaries, not exclusive file locks**. If work needs a shared model, API, compiler, component or data contract, propose the contract and tests, coordinate with the other team, and land an independently reviewable prerequisite before the dependent change.

No agent has blanket authority to merge, program hardware, send speculative MIDI, create uncontrolled firmware writes, or change the product direction. A sprint prompt is scoped authorization; a future-features backlog entry is not.

## 3. Cadence and work-in-progress

1. **Intake:** Create or adopt a clearly scoped GitHub Issue/assignment: problem, value to the musician, owner, boundaries, acceptance, dependencies, risk, and explicit deferred work.
2. **Plan:** Read root `CLAUDE.md`, current `main`, relevant domain docs, code and recent results; establish test baseline. For substantial UI changes, create a short visual/interaction design checkpoint.
3. **Implement:** Work in an isolated branch and environment, commit coherent increments, run applicable tests. Prefer a complete vertical slice over many unfinished surfaces.
4. **Review:** Open a **draft PR** with the standard handoff; address CI, data safety, visual issues and reviewer feedback. No agent merges automatically.
5. **Integrate:** Once approved, merge into `main`, verify post-merge status and update the acceptance ledger. Squash merge is acceptable; link the PR and test evidence.
6. **Continue:** Start a *fresh* agent coding session for the next independent assignment using latest `main`; do not keep expanding a closed PR.
7. **Validate physically:** When access to the real rig is available, execute prepared owner checklists, record evidence and dispatch resulting defects as discrete engineering work.

**Work-in-progress limit:** normally **one active implementation PR per team**. A narrow, explicitly scoped documentation-only PR may proceed separately. Do not stack unreviewed feature PRs unless documented dependency requires it. If a team is blocked on hardware, assign independent offline work, not unverified hardware behavior.

**Integration rule:** team branches start from merged `main` when practical. A team that began earlier should incorporate new `main` at a stable checkpoint, resolve conflicts and rerun affected tests. Never overwrite another team's worktree/database/process; isolate servers, ports, local paths, secrets, test data and output folders. Avoid multiple code sessions writing the same branch.

## 4. State model: implementation is not acceptance

Track two related but distinct things:

**Delivery maturity** (workflow state; tracked in PR/issue/handoff):

| State | Gate |
| --- | --- |
| Proposed / scoped | Problem, owner and testable acceptance agreed |
| Implemented | Code and initial tests exist on a feature branch |
| Software validated | CI passes; appropriate unit/API/browser, regression and backup tests passed; reviewer accepts software evidence |
| Integrated | Reviewed PR merged; branch and revision traceable |
| Hardware test-ready | Test procedure specifies topology, firmware, inputs, observations, safety, prerequisites and recovery; blockers flagged |
| Hardware validated *(where applicable)* | Owner ran the exact steps and recorded relevant device behavior in a dated report |
| Product accepted | Owner confirms workflow is useful, understandable and reliable for intended real-rig use |

These states need not be linear in every case: purely offline features can reach product acceptance without a hardware claim. **Never infer a physical maturity state from software-only evidence.** A component may be integrated but still hardware-open.

**Evidence/verification statuses** (use existing canonical vocabulary in `docs/verification-register.md`): `SW-PASS`, `HW-PASS`, `PARTIAL`, `OPEN`, `BLOCKED`, `FAIL`, `DEFERRED`. Record each *specific claim* and the *scope* of the observation, not a blanket success label. Owner observation of a preset recall does not verify all CC, SysEx, MIDI Clock or feedback pathways.

Also distinguish: manufacturer documentation, user declarations, simulated deliveries, messages handed to the driver, acknowledgements, independent observations and verified hardware state. No readback means no claim of confirmed pedal state.

## 5. Definition of done: software PR

A substantive engineering PR includes:

- Clear feature/user journey and **testable definition of done**; out-of-scope list.
- Changed surfaces, domain/API/schema or exported-file contracts, migration/compatibility and rollback considerations.
- Passing relevant backend/frontend/lint/build/browser CI; deterministic regression for fixed defects.
- Actual rendered UI screenshots and interaction checks for UI work (desktop, laptop/mobile as meaningful, keyboard, accessible focus, overflow).
- Safety case: management interactions are non-transmitting by default; no new unsafe auto-send or hardware write paths; unknown device capabilities never treated as verified.
- Preservation tests where relevant: profiles, rig identity, images/manuals, Scenes/Textures, existing backups and complete-restore behavior.
- Native data interchange: preserve unsupported fields or explicitly decline modified export; record source, version, hash evidence and round-trip boundaries.
- [Engineering Handoff](HANDOFF-TEMPLATE.md) in PR description or a linked document, including gaps, known failure modes and owner follow-up.
- Specific verification IDs created/updated in the [Verification Register](../verification-register.md), with `SW-PASS` only for software testing.

**Not required for every merge:** a physical rig test that the owner cannot yet execute. Such work remains `OPEN`/`BLOCKED` for hardware acceptance and any risky features stay gated/disabled. An agent should stop at the evidence boundary rather than fabricating tests or stretching scope.

## 6. Hardware acceptance package

For *each* owner-run test, prepare a numbered, actionable procedure containing:

1. **Claim and verification ID:** One or a few precise capabilities to prove.
2. **Baseline:** git revision/build, OS, versions, MIDI driver/ports, device/firmware, channels, routing diagram and current known/unknown state.
3. **Prerequisites and isolation:** controller/adapter bindings, required power, relevant permissions, official editor closed when Signal Loom owns ports; one process owns each exclusive port.
4. **Safety and restoration:** save untouched backups, identify any memory writes, how to undo/reload, safe audio levels, Stop/Disarm access, and unsupported/unsafe message types.
5. **Exact sequence:** what to click/send, message type/number/channel/range, order, expected behavior, and what to record at each step; start with read-only/offline, then least-risk live steps.
6. **Independent observation:** device screen, audio result, MIDI monitor, editor readback or documented response; distinguish observed response from outbound logs.
7. **Pass/fail criteria and failure branches:** exact acceptance bounds, partial outcomes, what to stop on, restoration after failure, evidence of recovery.
8. **Recording template:** date, physical wiring as tested, revisions, screenshots/log excerpts where safe, anomalies, comparison with expectation, owner sign-off, and deferred follow-ups.

Do not ship a generic “test it with hardware” note. Reuse existing [Session 4 checklists](../live-hardware-validation.md) and [Session 5 acceptance](../session-5-hardware-acceptance.md) as detailed examples. Keep copyrighted manuals, private user backups, machine identifiers and device serials out of the public repo.

An owner-run pass creates a **dated observation report** linked from the Verification Register. Failures stay visible and become small actionable issues assigned to a team; preserve evidence and any recovered previous state. Do not erase a failed result when later fixed—record the new run.

## 7. Review gates and change authority

- **Architectural cross-team gate:** an API/schema/compiler/library contract used by multiple teams needs a short proposal, backward-compatibility description, migration strategy and reviewer decision.
- **Hardware-risk gate:** MIDI routing/transmission semantics, controller write/import/export safety, firmware or global settings need explicit scope, defensive validation and recovery plan. Editor acceptance and device acceptance are separate.
- **Product gate:** user decides whether real workflows improve the experience; software quality alone cannot force a product-accepted status.
- **Merge gate:** passing relevant CI, no unexplained regression, PR/head/base verification, review of unresolved limitations and source-level safety claims. No silent auto-merge.
- **Documentation gate:** update the canonical relevant document only, not multiple competing versions of the same truth. Session reports are snapshots; the Verification Register is living evidence, Architecture is implemented design, Future Features is proposals.

For urgent regressions, a narrowly scoped corrective PR can supersede planned sprint work. Explain the interruption, test impact and safe revert path.

## 8. Hand-off and queue discipline

Every completed work package ends with an actionable handoff rather than “done”:

- What changed and why it matters to the musician.
- Links to branch/PR/commit/build and test evidence, with exact limitations.
- Risks and outstanding verification IDs.
- Owner test package (if hardware is implicated).
- Dependencies and next suggested independently shippable assignment.

Maintain a **validation queue**, sorted by risk and shared setup cost. Group safe tests that reuse the same physical wiring; keep high-risk write/firmware operations separate. Prefer retiring pending verification debt before increasing risk. The queue is not a substitute for the canonical verification statuses.

An agent may propose the next task, but only starts a new materially different work package when assigned. Do not continue running background tasks or claim to monitor CI after the session ends.

## 9. Maintenance and evolution

- Keep this document procedural and stable; place temporary sprint details in Issues, PRs and dated reports.
- Keep `CLAUDE.md` concise, linking here and to authoritative product/technical docs; update it when starting instructions change.
- Review this model through ordinary PRs when observed friction warrants a change. No ritual documentation updates solely for the sake of activity.
- The operating model applies to **every** new human/agent development session once merged into `main`. Existing sessions on older branches must explicitly pull/read it when appropriate.
