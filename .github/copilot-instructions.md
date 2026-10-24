# Copilot / GitHub Agent Instructions — Signal Loom

Start with the root [AGENTS.md](../AGENTS.md), then follow [CLAUDE.md](../CLAUDE.md) and the [Engineering Operating Model](../docs/engineering/OPERATING-MODEL.md). They contain the binding rules; do not create a parallel process here.

- Signal Loom is a local-first, musician-first creative instrument, not a speculative MIDI hardware automation system.
- Work only on the assigned Issue/PR scope, on an isolated branch; do not silently widen product requirements or modify another agent's branch.
- For implementation, provide actual code/tests and the [Engineering Handoff](../docs/engineering/HANDOFF-TEMPLATE.md) in the PR.
- For review, compare **the actual diff** with issue acceptance criteria, architecture, regression evidence and the [Verification Register](../docs/verification-register.md). Comment with reproducible `BLOCKER` / `MAJOR` / `MINOR` findings; avoid subjective style feedback that automated tools cover.
- Green CI means software checks passed, **not** physical device verification, safe preset writes, or product acceptance.
- Leave review and correction context in GitHub PR threads. Escalate architectural/product conflicts to the owner; do not assume comments automatically trigger another coding agent.
- Never auto-merge; never perform unapproved live MIDI, firmware, SysEx or device-state writes.

For the concrete reviewer/implementer handoff, follow [Agent Collaboration Playbook](../docs/engineering/AGENT-COLLABORATION.md).
