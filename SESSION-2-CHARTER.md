# Signal Loom — Session 2: From Prototype to Practical Rig Designer

**Repository:** https://github.com/WizardInDminor/signal-loom  
**Status:** Autonomous Session 2 build charter  
**Prerequisite:** Complete and merge Session 1 first, including the final review corrections.

> **To the implementation agent:** Read this document and the Session 1 records in full. Investigate the existing working application, prioritize the highest-value improvements, implement them, test them, and report the results. You have substantial technical and product autonomy within the guardrails below. This is an execution charter, not merely a request for a plan. Do not merge the finished pull request automatically.

## Mission

Continue the Signal Loom autonomous development experiment, building on the working application created during Session 1.

Session 1 established the core architecture: a persistent rig model, dimensionally accurate board layout, typed physical wiring, scene compilation, and Morningstar MC8/ML10X configuration planning.

**Session 2 should transform that foundation into a more intuitive, capable, and practical guitar rig management tool.**

The goal is not to rebuild the application, dramatically expand its architecture, or accumulate disconnected features. The goal is to substantially improve the experience of actually designing, wiring, configuring, and maintaining a real guitar rig.

You have broad autonomy to investigate problems, identify opportunities, prioritize work, and implement improvements. Use the existing design principles and architecture unless actual implementation experience demonstrates a compelling reason to change them.

Favor coherent, working capabilities over ambitious but unfinished features.

## 1. Reconnaissance and continuity

Before implementing changes:

1. Read `SESSION-1-CHARTER.md`, `SESSION-1-RESULTS.md`, `ARCHITECTURE.md`, `docs/research.md`, and the README.
2. Inspect the current implementation, test coverage, and repository status.
3. Confirm Session 1 is merged into the branch from which you intend to develop. **If not, do not develop on the old charter-only `main` branch**: use the fully reviewed Session 1 implementation as the base once accepted, and report the dependency.
4. Review the final Session 1 PR discussion and ensure its data-integrity corrections are present. Do not unintentionally regress autosave ordering, export freshness, or validation consistency.
5. Run the existing application and tests.
6. Evaluate the application as a musician attempting to configure a complex rig rather than solely as a developer examining components.

Identify the most significant remaining obstacles between the current application and a genuinely useful daily workflow.

You may reorganize or reprioritize the work described below based on actual findings, provided the core goals and completion criteria remain satisfied.

Document significant architectural decisions and discoveries, but do not let documentation substitute for implementation.

## 2. Primary product goal: A more intuitive design environment

The two major visual workspaces — the physical board and the connection designer — should begin to feel like complementary parts of a mature application.

### Physical board improvements

Improve the experience of arranging pedals and working with their physical properties.

Consider:

- More natural drag-and-drop interactions.
- Clearer placement, selection, alignment, snapping, and rotation.
- Better zooming and navigation for large boards.
- Readable labels and port indicators.
- Collision and clearance visualization.
- Useful placement measurements and feedback.
- Undo/redo where feasible.
- A practical distinction between devices mounted on the board and devices located elsewhere.

A device's outline, dimensions, orientation, and jack locations should remain synchronized.

Visual realism is desirable, but **accurate geometry and useful interaction take priority over product photography**.

### Jack-aware wiring

A central differentiator for Signal Loom should be that cables connect to actual physical ports, not arbitrary positions on generic pedal images.

Improve the wiring experience so users can understand and edit connections visually.

Ideally, users should be able to select or drag between compatible ports to create a connection, with appropriate validation and feedback.

Maintain clear distinctions among audio, MIDI, expression/control, and power wiring.

The connection planner should understand the practical differences between connector types, physical jack locations, and signal formats.

Do not assume every TRS connector represents stereo audio, or that every connector pair is electrically compatible.

Cable representations should remain editable, understandable, and associated with the persistent rig model.

## 3. Stereo routing and the Morningstar ML10X

This is a particularly important Session 2 development area.

The intended user owns a Morningstar ML10X and operates a rig containing both mono and stereo effects.

The application must accurately distinguish:

- The physical stereo input/output connections of an effect.
- The ML10X's five stereo loops and ten mono loop paths.
- Tip and Ring signal assignments.
- Physical TRS-to-dual-TS breakout cables.
- Logical routing through ML10X presets.
- Simple and Advanced routing capabilities, including firmware-dependent restrictions.

Investigate the existing implementation and improve its ability to represent realistic stereo signal chains.

Build a credible example involving a mono drive section feeding a stereo-capable effect and a stereo output destination.

Avoid representing stereo as merely a label attached to a mono cable.

A user should be able to inspect the left and right signal paths and understand how they are physically connected and logically routed.

Where Advanced Mode capabilities remain incompletely documented, preserve that uncertainty. Implement validated behavior without fabricating unsupported hardware capabilities.

A full native ML10X editor replacement is not required.

## 4. Device catalog and physical data enrichment

Session 1 established device profiles, user-defined ports, and an import pathway for external pedal dimensions.

Make this system more practical for someone building a real pedalboard.

Explore opportunities to improve:

- Device discovery and search.
- Adding devices to a rig.
- Editing and duplicating custom profiles.
- Assigning realistic dimensions.
- Editing jack positions graphically.
- Maintaining source attribution and confidence levels.
- Managing MIDI capabilities and power requirements.
- Importing user-supplied pedal dimension datasets.

Investigate whether additional open or appropriately licensed sources can improve the device library.

Do not vendor unlicensed third-party datasets or copyrighted product imagery without appropriate permission.

Support generic pedal silhouettes with accurate dimensions when real imagery is unavailable.

Preserve the distinction between verified manufacturer data, third-party estimates, and user-defined measurements.

Device profile editing should be approachable enough that a guitarist can add an uncommon pedal without manually editing database records.

## 5. Scenes, presets, and controller programming

Improve the workflow connecting desired sounds to actual hardware actions.

The user should be able to create scenes representing different song sections, specify desired device states, assign them to MC8 switches, and inspect the resulting MIDI commands.

This workflow should be understandable without requiring the user to manually calculate every Program Change and Control Change value.

Investigate improvements to:

- Scene creation, duplication, and organization.
- Selection of pedal presets and bypass states.
- Selection of ML10X routing presets.
- MC8 bank and switch assignment.
- Feedback about unsupported actions and controller limits.
- MIDI channel conflicts.
- Commands whose results depend on prior state.
- Clear presentation of generated MIDI messages.

Preserve the hardware-independent scene model and the existing deterministic compiler.

**Do not invent a complete native editor for proprietary pedal presets.**

A device profile may describe documented MIDI commands and patch selection behavior. Anything requiring a proprietary editor or undocumented protocol should remain an explicit limitation.

The application should communicate the difference between the user's desired sound configuration and the subset it can actually establish through MIDI.

## 6. Morningstar interoperability investigation

Continue the export research from Session 1.

The target hardware is:

- Morningstar MC8 — original version, not MC8 Pro.
- Morningstar ML10X.

The user owns both units, so real device validation is possible outside the autonomous coding environment.

### MC8

Review the existing MC8 export implementation and the evidence supporting its fixture-validated status.

Look for opportunities to improve compatibility, validation, diagnostics, and import/round-trip behavior.

Support a safe workflow using backups exported from the official Morningstar editor.

Do not claim editor or hardware validation unless those tests were actually performed.

### ML10X

Investigate the structure of ML10X backup files, especially the currently undecoded routing representation.

A potentially useful addition would be a **backup comparison tool** capable of comparing two official exports and identifying changed fields.

This would support controlled experiments in which the user changes exactly one loop, connection, or preset setting before exporting a second backup.

If sufficient evidence permits a reliable native export implementation, pursue it.

If the format remains insufficiently understood, preserve the current read-only approach and provide a more useful analysis/verification workflow.

Do not construct fabricated native configurations simply to satisfy a feature checklist.

### Hardware validation package

Provide concise instructions that allow the user to test the application against the MC8 and ML10X without risking their existing configurations.

Prioritize reversible, backup-first operations.

No automatic hardware writing is required or authorized.

## 7. Reliability and usability

Session 1 introduced important persistence and concurrency protections. Treat their final corrected behavior as a baseline.

Ensure that:

- Unsaved edits cannot silently be omitted from an export.
- Older save operations cannot overwrite newer edits.
- Application state remains coherent when switching between workspaces.
- Deleting or changing devices does not leave misleading connections or controller assignments.
- Import/export operations preserve project integrity.
- Unsupported configurations produce actionable diagnostics.
- Errors are visible rather than silently ignored.

Improve the overall experience where useful: empty states, navigation, form clarity, keyboard interactions, and user feedback.

Do not overinvest in decorative styling at the expense of functionality.

## 8. Priorities and implementation boundaries

Use the following priority framework.

**P0 — Coherent practical workflow**

Deliver meaningful improvements to the physical design and wiring experience, including a credible stereo-capable rig example. Preserve scene compilation, persistence, and existing functionality.

**P1 — Hardware configuration usability**

Improve scene-to-MC8 programming, ML10X routing visualization, compatibility validation, and the usefulness of configuration exports.

**P2 — Data enrichment and productivity**

Improve the device catalog, jack editing, reusable profiles, and other high-value quality-of-life features.

**P3 — Research and extensions**

Investigate additional interoperability, backup comparison, and native export opportunities where reliable evidence supports progress.

Do not let a difficult reverse-engineering problem consume the entire session.

If the Morningstar file formats remain opaque, leave that work well documented and continue improving the usable application.

Do not introduce unrelated features such as user accounts, social functionality, cloud hosting, subscription systems, AI integration, or a universal manufacturer-specific preset editor.

## 9. Completion criteria

Session 2 should produce a demonstrably more useful application, not simply a larger codebase.

At minimum:

1. A user can create or customize a realistic rig using saved device profiles and physical dimensions.
2. Users can edit physical jack positions and see those positions represented consistently in the board and connection interfaces.
3. A stereo-capable rig can be represented with distinct, validated left/right audio paths, including an ML10X configuration.
4. Users can inspect how physical cabling relates to logical switcher routing.
5. A user can create or modify three different scenes and assign them to MC8 switches using the application interface.
6. The compiled controller configuration reflects those changes correctly, with deterministic output and meaningful warnings for unsupported actions.
7. Project persistence, import/export, and save ordering remain reliable during realistic user interactions.
8. Session 1 capabilities continue functioning, and newly implemented core behaviors have automated regression coverage.
9. The application can be operated through a coherent end-to-end workflow without manual database manipulation or source editing.
10. Morningstar interoperability improvements are accompanied by explicit evidence levels. Unverified native exports must not be advertised as supported.
11. The repository contains a clear Session 2 results report and instructions for using the improvements.

Where practical, automate acceptance tests using pytest and Playwright.

Include realistic scenarios rather than testing only isolated components.

In particular, test edits followed immediately by export, rapid successive edits, and state changes across workspaces.

## 10. Expected deliverables

Produce:

- Working improvements to the existing application.
- Relevant tests and passing quality checks.
- Updates to the README and architecture documentation where necessary.
- Any useful research or compatibility notes.
- A `SESSION-2-RESULTS.md` report.

The results report should include:

- What changed and why.
- New user-facing capabilities.
- Important architectural decisions.
- Tests performed and their actual results.
- Any regressions or unresolved defects.
- Morningstar interoperability status.
- Features deliberately deferred.
- Recommended next steps for the user to test with their actual pedalboard.

Use a dedicated development branch and open a pull request targeting the appropriate base branch.

Do not merge the PR automatically.

## 11. Autonomy and execution

You have broad implementation autonomy.

Make engineering and interface decisions independently when the product goals are clear. Investigate existing code rather than assuming it is incomplete. Favor extending established components over introducing competing systems.

You may identify better approaches than those suggested in this document.

If your investigation reveals that a proposed feature is technically impractical, misleading, or less valuable than an alternative, use your judgment. Document the reasoning and deliver the most useful achievable result.

Build incrementally, test continuously, and commit coherent changes.

Do not stop at reconnaissance, planning, or documentation. Execute the development work.

If external hardware, sample files, or inaccessible documentation become blockers, clearly record the exact dependency and continue with independent tasks.

**The defining question for Session 2 is:**

*Can a guitarist use Signal Loom to meaningfully plan, wire, and configure a real-world stereo pedalboard with an MC8 and ML10X, while trusting the application to preserve their work and distinguish verified hardware capabilities from assumptions?*

Use that question to guide implementation priorities.

The objective is a practical, integrated product improvement—not the maximum possible number of features.

**Begin by inspecting the repository, establishing the current baseline, and executing the session.**
