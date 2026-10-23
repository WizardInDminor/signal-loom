# Signal Loom — Engineering PR & Acceptance Handoff Template

Copy this template into the pull request description (or link a completed session report). Replace placeholders with concrete evidence; mark truly inapplicable sections **N/A** rather than silently omitting them. For the binding process, see [Engineering Operating Model](OPERATING-MODEL.md). Verification claim statuses live **only** in [Verification Register](../verification-register.md).

## 1. Assignment and ownership

- Work package / issue:
- Team and accountable engineering session:
- Base branch and revision:
- Feature branch / PR:
- Problem and intended musician benefit:
- Scope / explicit non-goals:
- Cross-team dependencies or shared contract approvals:

## 2. Delivered functionality

- Working user journey:
- Changed components/API/schema/file formats:
- Existing behavior preserved (including MIDI/backup boundaries):
- Owner-visible UX decisions and screenshots:
- Deferred capabilities and reasons:

## 3. Verification — software

| Test | Environment / command or CI run | Result | Evidence link |
| --- | --- | --- | --- |
| Unit/backend | | | |
| Frontend lint/types/build | | | |
| Browser/end-to-end | | | |
| Regression/compatibility/backup | | | |
| Visual/mobile/keyboard QA (if UI) | | | |

- Source commit and test environment:
- Observed errors or skipped tests and explanation:
- Relevant Verification Register IDs (typically `SW-PASS` for these claims):
- Claims **not** established by these software tests:

## 4. Safety, data and interoperability review

- Does any normal action transmit MIDI? If so, state exact approved boundary; otherwise **No**:
- Hardware writes/configuration changes possible? Safeguards, arming and stop behavior:
- Data preservation, exports, restore and backward compatibility:
- Unknown or unsupported protocol/file fields: preserved / blocked / explicitly unsupported:
- Manufacturer-documented vs user-declared vs owner-observed claims:
- Potential irreversible actions, hazards or sound-level risks:
- Safe rollback/revert path and backup required:

## 5. Owner acceptance package (when applicable)

- Verification claim/ID:
- Maturity now: implemented / SW-validated / integrated / hardware-ready / hardware-validated / product-accepted (only evidence-supported states):
- Prerequisite equipment, wiring, channel, firmware and software version:
- Working backup/restore steps, baseline snapshots and safe audio precautions:
- Test steps (number, exact operation, MIDI type/CC/PC/channel/value as relevant):
  1. 
  2. 
  3. 
- Expected observable outcomes (not merely “message sent”):
- Pass/fail criteria, what to do on partial/failure, stop/disarm and restoration:
- What this test **does not** prove:
- Evidence to capture (date, observations, screenshots/logs, revision, and owner notes):
- Hardware test status/limitations and link to dated test report (or **OPEN / not run**):
- Product acceptance decision by owner (or **pending**):

If no physical rig interaction is involved, explain why hardware testing is N/A; still describe musician-facing acceptance as appropriate.

## 6. Review and release decision

- CI head SHA / merge status:
- Reviewers and outstanding findings:
- Risks accepted explicitly:
- Blocked pending hardware vs safe to merge with gated behavior:
- Next independent work package proposal and dependencies:
- Merge authorization: **Owner/reviewer decision required — no autonomous merge.**

---

**Anti-patterns:** “all tests passed” without naming environments; calling a driver write “pedal verified”; dropping unknown native controller settings on re-export; treating a merged PR as full product acceptance; claiming an unrun owner test as successful; silently reusing a prior physical topology after cables may have changed.
