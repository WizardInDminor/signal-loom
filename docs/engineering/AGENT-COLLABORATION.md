# Agent Collaboration Playbook — Signal Loom

**Status:** Pilot process. **Authority:** [Engineering Operating Model](OPERATING-MODEL.md). **Purpose:** remove manual message relay between engineering agents while preserving owner product decisions and evidence boundaries.

## What lives where

| Source | Owns |
| --- | --- |
| Product owner / accepted product direction | Feature intent, tradeoffs, final product and hardware acceptance |
| GitHub Issue | Scoped assignment, testable acceptance, risks, dependencies, non-goals |
| Branch / PR | Implemented code, review threads, correction commits, CI result and proposed merge |
| [Verification Register](../verification-register.md) | Canonical status and evidence index, including hardware debt |
| [Architecture](../../ARCHITECTURE.md) and ADRs | Accepted technical designs and constraints |
| Agent chat/session | Ephemeral working context; not a substitute for committed decisions |

## Pilot roles

- **Product owner:** approves scope and tradeoffs, adjudicates unresolved disagreements, authorizes a merge, performs owner-run hardware validation.
- **Claude (default implementation role):** accepts a single GitHub Issue, proposes a brief plan for substantial work, implements on its own branch, opens a draft PR with test evidence and the standard handoff, replies to review findings.
- **Codex, ChatGPT GitHub-connected review, or Copilot review (as assigned):** checks issue/diff/CI, leaves independent GitHub PR findings, then rechecks corrections. These are distinct tools; enabling one does not make this particular ChatGPT conversation continuously run.
- **GitHub Actions:** executes software checks. Passing checks do not imply hardware success.

## Normal sequence

1. **Owner / engineering management:** create or adopt one scoped Issue using the feature or defect template. Assign an implementation agent explicitly; do not launch multiple agents into the same branch.
2. **Implementer:** inspect current `main`, baseline tests and relevant docs. Plan briefly, make changes in an isolated branch, open a **draft** PR referencing `Closes #N` when appropriate, and include the Engineering Handoff.
3. **Reviewer:** inspect the actual changes and evidence. Post `BLOCKER`, `MAJOR`, or `MINOR` findings on PR review threads, with affected file/behavior, why it matters and an actionable exit criterion. Distinguish scope discrepancies from bugs.
4. **Implementer:** reply to each finding with `fixed in <SHA>`, `not reproducible, evidence:`, or `needs owner decision:`; push only to the implementation branch and update tests/handoff as needed.
5. **Reviewer:** re-read the updated head and rerun/check relevant evidence. Resolve addressed threads, or explain why open. If agents disagree about product intent, stop and ask the owner rather than cycling indefinitely.
6. **Integration:** ensure required `backend`, `frontend`, `e2e` checks pass and review conversations are resolved. Present unresolved limitations and verification debt to the owner; **do not auto-merge**.
7. **Post-merge:** record accepted merge SHA and outstanding physical/product validation separately. New defects get new issues.

This sequence is a **protocol**, not a claim that GitHub automatically summons a particular agent when any comment is posted. Use GitHub's supported issue assignment, agent/session UI, explicit review requests or agent invocation to hand off between actual sessions. Some models require a fresh session to read new comments. Do not install webhooks or autonomous loops without owner review.

## Review severity / escalation

| Class | Meaning | Action |
| --- | --- | --- |
| `BLOCKER` | Unsafe or destructive behavior, credible data loss, security defect, broken accepted requirement, or unsupported hardware-state claim | Cannot merge until corrected or owner explicitly decides on a safe alternative |
| `MAJOR` | Functional defect, regression, inadequate test of key behavior, compatibility break, or significant UI failure | Correct and recheck before recommending merge |
| `MINOR` | Limited edge case, documentation or maintainability defect with bounded impact | Record and resolve or explicitly defer with rationale |
| Product/architecture decision | Conflicting acceptance criteria, disputed UX or shared-domain contract | Pause relevant scope and request owner decision |

Avoid PR comment spam. Consolidate non-critical observations; maintain one thread per independently verifiable issue. Never use a successful outbound MIDI log as evidence of independent pedal readback. Verification claims follow the existing register vocabulary.

## First pilot success criteria

- The product owner creates/approves an Issue once, without shuttling implementation/review transcripts.
- Implementer and reviewer exchange at least one concrete review/correction cycle **in GitHub**.
- Tests and the PR handoff identify software and hardware evidence separately.
- The owner receives a short acceptance decision package: goal, delivered behavior, CI head, remaining risk and exact hardware actions.
- Measure manual relay count, review iterations, time spent unblocking agents and review quality before investing in Constellation orchestration.

## Permissions and stop clauses

No automatic merges, broad rewrite, unapproved live sends, hardware writes, secret disclosure, branch rule changes or acceptance-state promotion. For risky changes, document recovery and obtain explicit scope. Keep the established one-active-PR-per-team WIP limit.
