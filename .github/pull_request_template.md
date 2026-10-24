## Assignment

- **Issue:** Closes #
- **Engineering team / implementing agent:**
- **Base revision at start / last code-changing commit / current head SHA (final handoff):**
- **Musician-facing change:**
- **Scope / explicit non-goals:**
- **Shared-contract or architecture decision links:**

## Change summary

- Working user journey and changed modules:
- Compatibility, data and backup preservation:
- UI screenshots / keyboard / mobile evidence (if applicable):
- Deferred behavior and known limitations:

## Verification

| Evidence | Result / URL |
| --- | --- |
| Backend / unit | |
| Frontend lint, typecheck and build | |
| Playwright / browser | |
| Regression, import/export or backup (as relevant) | |
| Visual/mobile/keyboard QA (as relevant) | |
| Verification Register IDs and statuses | |

**Source commit, current CI head and test environment:**

**Authoritative evidence read-back (final handoff):** Re-open this PR and verify the actual head SHA, saved description, test counts, screenshot links, latest required CI, resolved review threads and owner-accepted limitations before requesting merge. A claimed successful metadata edit is not evidence it persisted; update and read back rather than assuming.

**What these tests do NOT prove:**

## Safety and hardware boundary

- Any normal flow transmitting MIDI? Approved scope and guards:
- Device writes / SysEx / firmware / presets affected? Safeguards and recovery:
- Unknown fields / native-file compatibility preserved or explicitly blocked:
- Physical behavior owner-observed? **No / Yes, link dated report**
- Outstanding hardware tests and restoration instructions:

## Review and owner gate

- **Independent reviewer:**
- **Open BLOCKER / MAJOR / MINOR findings:**
- **Owner decisions required:**
- **Merge requested?** **No — draft / Yes — owner confirmation required**
- **Next independent work package:**

---

**Binding requirements:** See [Engineering Handoff Template](https://github.com/WizardInDminor/signal-loom/blob/main/docs/engineering/HANDOFF-TEMPLATE.md) for the full PR handoff and [Agent Collaboration Playbook](https://github.com/WizardInDminor/signal-loom/blob/main/docs/engineering/AGENT-COLLABORATION.md) for review/correction etiquette. Complete that handoff here or link a filled-out version; don't present this short template as a replacement. CI green means software checks passed, *not* physical verification or product acceptance. Do not auto-merge.
