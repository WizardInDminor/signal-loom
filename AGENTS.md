# Signal Loom — Shared Instructions for Engineering Agents

This is the common entry point for Claude, Codex, Copilot and other engineering agents. Do not treat chat history as project authority.

## Read before planning or editing

1. [Engineering Operating Model](docs/engineering/OPERATING-MODEL.md) — responsibilities, scopes, reviews, safety, integration and acceptance gates.
2. [README](README.md), [Architecture](ARCHITECTURE.md) and [Creative Instrument Vision](docs/creative-instrument-vision.md).
3. [Verification Register](docs/verification-register.md) and relevant dated hardware reports before making verification claims.
4. [Agent Collaboration Playbook](docs/engineering/AGENT-COLLABORATION.md) for coordination and PR-review handoffs.
5. The assigned GitHub Issue, related PRs and current `main`; read directory-local `AGENTS.md` files when changing those directories (notably `frontend/AGENTS.md`).

`CLAUDE.md` is an additional onboarding entry point. These files complement, not override, the Operating Model. If instructions or accepted design disagree, stop the affected change and request a product/architecture decision.

## Authority and roles

- **Product owner:** determines intended behavior, priorities, acceptance and authorization of hardware-risk operations.
- **Implementing agent:** plans and codes the *assigned* issue, runs applicable tests, opens a draft PR, provides the standard handoff, and addresses review findings.
- **Reviewing agent:** independently inspects the requirements, actual diff, risk, regression coverage and CI; records actionable findings on the PR. Reviewing is not a substitute for the owner's product/hardware acceptance.
- **Integration authority:** the owner explicitly authorizes merges. No agent auto-merges, claims user hardware observations, or treats green CI as product acceptance.
- **Team A / Team B boundaries:** remain as defined in the Operating Model; shared contracts require cross-team coordination.

An agent is assigned to a role for a work package; model identity alone does not confer decision authority. Avoid two agents simultaneously writing the same branch or worktree.

## Standard work cycle

Issue with testable acceptance → scoped implementation plan → isolated branch → draft PR with [Handoff Template](docs/engineering/HANDOFF-TEMPLATE.md) → CI and independent review → corrections and re-review → explicit merge decision → separately tracked hardware/product acceptance.

Use GitHub Issues and PRs as the durable coordination channel. Link issue, PR, commit, CI run and verification IDs. Do not ask the product owner to relay another agent's messages; leave concrete engineering findings directly on the relevant issue or PR when the tool permits.

## Safety and truthfulness

- Default to **offline and non-transmitting** behavior; never send speculative MIDI, write presets or firmware, alter device configuration, or operate real hardware without explicitly approved scope and a recovery path.
- Preserve user data, images/manuals, backups, rig/instance identity, unknown native-file fields and compatibility.
- Differentiate manufacturer documentation, user declaration, simulation, driver-send logs, and owner-observed hardware evidence; none implies another.
- New or changed behavior requires appropriate tests and honest coverage claims. Respect the Verification Register's statuses (`SW-PASS`, `HW-PASS`, `PARTIAL`, `OPEN`, `BLOCKED`, `FAIL`, `DEFERRED`).
- Do not broaden issue scope, resolve product ambiguity by assumption, or silently modify accepted constraints.

## Review protocol

Findings should identify a severity (`BLOCKER`, `MAJOR`, `MINOR`), affected code/requirement, observed risk, expected behavior and a practical verification criterion. The implementer replies with a correction commit or an evidence-based objection. The reviewer rechecks and resolves threads; the owner can adjudicate deadlocks. No agent self-declares a disputed thread resolved.

Before declaring software-ready, check the current PR head, required `backend`, `frontend`, `e2e` checks, outstanding threads, stated limitations and the owner handoff. GitHub branch rules enforce some of these; they do not replace human product acceptance.
