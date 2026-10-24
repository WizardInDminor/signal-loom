---
name: "Feature / engineering work package"
about: "Define one testable, scoped Signal Loom feature for an implementation agent."
title: "[Feature] "
labels: []
assignees: []
---

## Product goal and musician value

Describe the problem and the expected user-facing outcome. Link relevant accepted product direction.

## Acceptance criteria

- [ ] Observable behavior / user journey:
- [ ] Regression or compatibility guarantee:
- [ ] Evidence required (unit, API, browser, visual, backup, etc.):

## Scope and non-goals

**In scope:**

**Explicitly out of scope:**

## Dependencies and architecture boundaries

Link related issues, ADRs, domain contracts and known implementation constraints. Identify whether Team A, Team B or a shared-contract change owns the work.

## MIDI, data and hardware risk

- Expected to transmit MIDI or write device state? **No / Yes (explicitly define approved boundary)**
- Data, presets, imports/exports, backups, manuals or image preservation concerns:
- Software-verifiable claims vs owner-run hardware claims:
- Safe rollback/recovery:

## Implementation assignment and review

- **Implementing agent / team:** 
- **Independent reviewer:** 
- **Target base:** `main`
- **Unresolved decisions requiring the product owner:**

Reviewers and implementers: follow [AGENTS.md](../../AGENTS.md), the [Engineering Operating Model](../../docs/engineering/OPERATING-MODEL.md) and [Agent Collaboration Playbook](../../docs/engineering/AGENT-COLLABORATION.md). No agent auto-merges, performs unapproved hardware operations or claims product acceptance.
