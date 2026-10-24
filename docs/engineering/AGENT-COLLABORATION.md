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

## Pilot #1 retrospective — app-wide Dark Mode (2026-10-24)

**Evidence:** [Issue #20](https://github.com/WizardInDminor/signal-loom/issues/20), [merged PR #21](https://github.com/WizardInDminor/signal-loom/pull/21), [final green CI run](https://github.com/WizardInDminor/signal-loom/actions/runs/40104795519), and [visual evidence](https://github.com/WizardInDminor/signal-loom/tree/1b0d58130ab22f7ca7e931158782d8878b3580be/docs/screenshots/dark-mode-pr21). Owner accepted the screenshots, explicitly deferred a darker pedalboard canvas, and authorized the squash merge `1b0d581`. This pilot established a review/correction loop *without the owner relaying engineer-to-reviewer transcripts*. It did **not** demonstrate autonomous, guaranteed session triggering.

### Distinguish execution from acknowledgment

- This repository used **Claude in GitHub's hosted coding-agent experience**, not the separate `anthropics/claude-code-action` workflow. Do not add the latter, configure `allowed_bots` or widen tokens/webhooks in response to a hosted-agent stall without a separate, explicitly reviewed architectural decision. `.github/workflows/ci.yml` is for software CI, not agent dispatch.
- Record **PR delivery state** (draft, review requested, changes requested, CI, approved, merged) separately from **agent execution state** (no session, session started, session finished). A comment or an 👀 acknowledgment proves only recognition, **not** that work is running. For this pilot, GitHub's PR timeline exposed `copilot_work_started` and `copilot_work_finished` events; use those or the hosted agent's session view to check actual execution. A complete session need not imply a correct artifact.
- **Observed, not guaranteed trigger semantics:** the first formal `REQUEST_CHANGES` review preceded a corrective Claude session; a later `COMMENT` review and two plain `@claude` follow-up comments received no recorded work-start event despite 👀 acknowledgments; launching an explicit session through **GitHub → Agents** did start work; a subsequent `REQUEST_CHANGES` review preceded another session. These observations do **not** isolate review type from event/agent/session context. Do not describe `REQUEST_CHANGES` as a documented or guaranteed trigger. Never manufacture a changes-requested review just to wake an agent.
- **Fallback:** check the issue/PR and its session/timeline first; avoid repeated comment spam. When there is no execution-start event and work genuinely remains, launch an explicit hosted agent session against the **existing PR/branch** through GitHub Agents, with a narrow brief. Do not create a competing implementation PR or simultaneously run multiple agents writing the same branch. If the interface cannot resume the existing branch, escalate rather than silently fork.

### Verify deliverables, not completion claims

- An agent stated that it updated PR #21's description, but a subsequent GitHub read still showed the original code SHA, **six** theme tests and “screenshots not committed,” although **nine** tests and 34 images existed. The integration reviewer corrected that description and then **fetched it again** before merging.
- After any significant GitHub write (PR description, branch, commit, screenshot attachment, CI claim, review-thread resolution), **read the authoritative object back** from GitHub and check the actual values. For a PR's final handoff check at least: latest head SHA; last code-changing SHA if different; source vs CI head; test counts/results; evidence links that actually exist; accepted limitations; review threads; and owner decision. Avoid a CI rule requiring every intermediate push to keep a changing head SHA in prose perfectly synchronized; apply the gate at final handoff/merge.
- GitHub reviews posted through the current connected tool appeared under the **owner's account**, even when independently reasoned by another model. Do not misrepresent that as approval from a second GitHub identity. The repository presently requires zero approving reviews and a manual owner merge decision; changing approval-count or agent permissions warrants a separate settings review.

### Review boundaries and improvements to trial later

- Default to at most **two or three substantive correction rounds** before escalating unresolved product/architecture disagreements to the owner. A targeted documentation follow-up is not inherently another engineering dispute. No review may force arbitrary stylistic churn contrary to explicitly accepted tradeoffs.
- Keep software CI as first-line regression protection, but treat `action_required` (owner must approve a new agent-head workflow) as **not tested**, not as a CI pass or test failure. Recheck required checks **on the precise head being merged**. Preserve owner control of release, hardware and product acceptance.
- The next coordination experiment should track *requested action → agent started → agent finished → artifact independently verified*, not simply *comment posted → reaction*. Only introduce labels, bots, scheduled agent dispatch, or a Constellation orchestration layer after additional observed cycles justify them.
