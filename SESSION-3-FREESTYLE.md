# Signal Loom — Session 3: Freestyle Lab

**Branch:** `experiment/session-3-freestyle`  
**Baseline:** Fully merged Sessions 1 and 2 on `main` (checkpoint commit `e3e90acd0bdfb618ddcdc1fef0dfafe548183b97`)  
**Mode:** One autonomous, high-agency creative engineering session  
**Working theme:** *Make Signal Loom delightful.*

> **Claude Code:** This is deliberately **not** another detailed feature specification. Sessions 1 and 2 proved the architecture, built the domain model, and added meaningful workflows. Your assignment is to explore, choose, and execute an improvement that makes this application feel like a compelling product. Surprise us with thoughtful, useful design or an unusually good interaction. You are authorized to make substantial changes **on this experiment branch**, not to `main`. Ship working code, not merely mockups or a design proposal.

## The challenge

A guitarist should open Signal Loom and feel that someone who understands real pedalboards designed the software. The application already knows about physical dimensions, jacks, cables, stereo routing, ML10X signal paths, MIDI control, scenes, and MC8 banks. Use that unusually rich model to create a memorable, intuitive experience.

This is a chance to try something the cautious Session 1/2 charters would not have explicitly prescribed.

**Your success metric:** After this session, a person familiar with the previous version should find at least one interaction, visualization, or user journey noticeably more enjoyable, understandable, or useful — and the application should remain trustworthy.

## Freedom to choose a direction

First, actually inspect and use the current application. Review `README.md`, `ARCHITECTURE.md`, `SESSION-1-RESULTS.md`, `SESSION-2-RESULTS.md`, and the current code. Explore the demo rigs as a user. Look for friction, clutter, visual opportunities, and overlooked capabilities.

Then **pick your own creative thesis**. For inspiration, not as a checklist:

- **Board-design delight:** a compelling pedalboard canvas, beautiful but practical pedal representations, clearer selection and movement, live dimensions, smarter zoom/pan, cable routing overlays, polished drag-to-connect interactions, visual fit and clearance.
- **Signal-path storytelling:** a visual ML10X preset explorer that highlights the actual Tip/Ring path through the physical devices, lets the user compare scenes, or makes mono-to-stereo transitions immediately understandable.
- **A scene-first musician workflow:** pick a song section and see the rig come alive — engaged/bypassed devices, selected signal paths, footswitch mappings, MIDI message flow and manual actions — without needing to read tables of numbers.
- **A visual Advanced Mode editor:** if achievable, create and edit routing graphs with clear constraints and meaningful warnings rather than editing text edges.
- **First-run experience and identity:** thoughtful welcome screen, tutorial or guided tour, improved visual design language, helpful empty states, an onboarding journey that shows why this is more than a generic pedalboard planner.
- **An unexpectedly useful workshop tool:** cable-kit/build plan visualization, physical connectivity inspection, rig comparisons, visual scene diff, reversible configuration experiments, or another novel feature the architecture enables.

You may combine complementary ideas, invent a better one, or reject this list entirely. **Don't attempt all of them.** Prefer one standout, integrated, testable user experience, then a few supporting refinements. The key is to make a noticeable leap in usefulness and polish.

You are encouraged to be creative with layout, typography, hierarchy, motion, navigation, interaction patterns, and visual explanations. Use accessible, responsive UI and sensible defaults; be deliberate rather than ornamental.

## Boundaries (the stable baseline remains trustworthy)

The fun part is broad. The guardrails are narrow and firm:

1. **Work on `experiment/session-3-freestyle` only.** Do not push to `main`, retarget or overwrite prior branches, merge PRs, or alter real hardware. Open a **draft** PR targeting `main` when finished.
2. **Protect user data.** Preserve project-file compatibility, existing SQLite rigs, IDs, migrations, revisioned single-writer saves, conflict handling, undo/redo, and save-before-export. Add deliberate migrations if changes are necessary. No silent data deletion or destructive resets.
3. **Preserve domain integrity.** Physical cables are not ML10X virtual paths; stereo conductors are not interchangeable; scene intent is not a promise of remote control on an analog pedal; unsupported MIDI capabilities remain explicit. Do not fabricate device dimensions, MIDI assignments, jack positions, or actual hardware behavior.
4. **Keep vendor claims honest.** Original Morningstar MC8, not MC8 Pro. Native MC8 export/import is fixture-validated, not official-editor/hardware-validated. ML10X native export remains blocked pending real evidence. Do not claim to have tested physical hardware.
5. **Respect licenses.** Do not commit unlicensed pedal photography, datasets, font files, or trademark assets. Use original SVG/CSS representations and permissively licensed dependencies with appropriate notices.
6. **Protect the working product.** The existing demo workflow, exports, routing validation, backend API, and controller planning should continue working. Favor reversible changes, small coherent commits, tests, and clear feature flags for risky new behavior.
7. **No unrelated infrastructure.** Don't add authentication, mandatory cloud hosting, billing, telemetry, or credentials. Offline/local-first still matters.
8. **Be feasible within a single session.** If an idea is technically too large, complete a worthwhile vertical slice. Partial but usable is better than an ambitious untested skeleton.

## How to run the freestyle session

1. **Reconnaissance:** Establish a green baseline; explore the interface end to end; identify friction and visual/design opportunities.
2. **Choose your thesis:** Document a short `SESSION-3-DIRECTION.md` with the one experience you will transform, why it matters, and how you will know it worked. No lengthy approval loop is needed.
3. **Build:** Implement the chosen direction decisively. Reuse the existing coherent rig model; do not create disconnected concept screens.
4. **Validate:** Run backend tests, lint, typecheck/build, and relevant Playwright flows. Add a focused browser scenario proving the new user journey. Capture actual screenshots if your environment supports it, and visually review them.
5. **Reflect:** Write `SESSION-3-RESULTS.md` documenting what changed, the creative decisions, before/after experience, test counts, caveats, and one or two promising next ideas.
6. **Publish for review:** Commit to the freestyle branch and open a **draft PR** against `main`. Leave it unmerged. Distinguish verified functionality from exploration or prototype behavior.

### Definition of success

Signal Loom is noticeably more useful or delightful **without losing the correctness, reliability, and safety established by Sessions 1 and 2**.

You have broad creative and engineering autonomy. Make decisions, implement them, test the outcome, and show the result. **Have fun with the product.**
