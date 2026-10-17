# Signal Loom — Device Manuals & MIDI Command Library

> Focused follow-up charter for \`experiment/session-3-freestyle\` / draft PR #3.
> This is a user-requested next implementation, not a speculative redesign.
> Do not merge or modify \`main\`.

## Why this matters

The owner has completed substantial hands-on testing of the physical board, photographed pedals, image-assisted jacks, underside mounting, power planning, and wiring. Those foundational workflows are becoming useful.

The next pain point is **reconstructing sounds and MIDI control behavior reliably**. A guitarist can spend hours programming a pedal, ML10X routing preset, and Morningstar MC8 switch, only to struggle to remember how the configuration works later. Signal Loom should make device commands easy to look up and apply, and keep an honest, durable record of *which actual MIDI values a scene will send*.

There is already a good foundation:
- \`DeviceProfile.midi\` includes interfaces, program-change support/numbering, CC maps, and bypass semantics.
- \`DeviceInstance.midi_channel\` represents the channel for a placed unit.
- \`Scene.device_states\` carries PC/bank, CC values, bypass intent, and notes.
- \`domain/compiler.py\`, the Stage, the MC8 plan, and existing validation use those states.
- Local managed image assets and opt-in image-inclusive project exports are established patterns.

Build on these concepts. Do not replace the compiler, create an unrelated MIDI planner, or imply hardware has been programmed by the application.

## Requested deliverable

A user should be able to:

1. Open a device profile, upload a PDF user manual, and view it later from Signal Loom.
2. Define, inspect, edit, and favorite a device-specific MIDI command (e.g. "engage effect", "recall favorite", "set mix").
3. Attach the relevant manual and page reference to a command, when known.
4. In the Scene editor, pick a pedal and apply a named favorite command without re-entering CC/PC numbers.
5. Inspect the **exact MIDI messages** that the scene and MC8 plan will send, including target, channel, number, and value.
6. Save, reload, and export/import the rig without losing scene behavior; if a command definition changes later, existing scenes do not silently change their MIDI output.

Keep the workflow useful even when a device profile was imported from Pedal Playground with dimensions but no MIDI map.

## Part A — Local device manuals

Support user-supplied PDF documents associated with reusable device profiles:
- Upload, list, rename/title, open/view, replace, and detach/remove documents.
- Allow multiple manuals per profile (full manual, quick-start, MIDI implementation chart).
- Preserve manufacturer/model identity and existing profile data. Do not store binary PDF bytes inside a normal profile JSON object.
- Manage documents locally under a controlled storage directory; never commit uploads to GitHub or automatically download manufacturer manuals.
- Handle missing local documents gracefully (for imported projects or copied database metadata).
- Use bounded file size, actual PDF signature/content checks, opaque identifiers, safe file paths and filenames, conservative serving headers, and safe viewing behavior. Do not accept arbitrary document URLs or paths as server-side file reads. No automatic JavaScript or active-content execution from a PDF.
- A simple in-app document viewer or explicit open/download interaction is sufficient. Being able to jump to a page is useful; do not promise universal PDF deep-link behavior if browser support is inconsistent.
- Text extraction/search within PDFs is **optional** in this pass. If added, keep it local and do not require OCR, cloud inference, or an external service. The minimum useful implementation is a reliable uploaded-document viewer with page references.
- Reuse asset-storage patterns where sensible, but don't force PDF documents through the image decoder, image metadata, or image crop pipeline.
- Reference-aware deletion: do not delete a document still attached elsewhere or leave silent broken references. Cleanup should be deliberate.

**Rights and privacy:** Manuals are user-supplied and local. No bundled third-party PDFs, no automatic redistribution, no assumption that uploaded documents can be shared. A project export including manual bytes must be an explicit opt-in, separate from ordinary metadata-only export. Preserve support for existing format-1 projects and current image behavior.

## Part B — Named MIDI command definitions

Create a user-editable **MIDI Commands** section on each device profile. A command definition should have stable identity, human-friendly name, optional category/tags, description, and an optional favorite flag.

Support a focused first set of commands:
- Control Change (CC): number 0–127, value or selectable value/meaning; clearly distinguish fixed actions from commands requiring a value.
- Program Change (PC): wire-level 0–127 and optional bank MSB/LSB when relevant; preserve the distinction between the device's displayed preset number and the value sent on the wire.
- Intent semantics such as engage/bypass/absolute set/toggle when established, with visibility into whether the resulting state is deterministic.
- A source/evidence reference such as "user entered", "documented in uploaded manual, page N", or "verified on hardware"; attaching a manual does **not** independently verify a command. Hardware validation must be an explicit user claim.

Do not invent CC numbers, bypass values, PC ranges, MIDI channels, or manufacturer command semantics. Allow partial/unknown information and clear labels. Support an imported device that lacks a published MIDI implementation chart. Keep this compatible with the existing \`MidiSpec.cc_map\`, program-change and bypass definitions; avoid two contradictory sources of truth. If new reusable command objects are introduced, make their relationship to the existing map explicit and tested.

Favorite commands should be prominently visible, searchable, and easy to reuse. They are not necessarily a complete catalog of the device's MIDI messages.

**Scope boundary:** Start with individual PC or CC command definitions and their meaningful values. Bundled multi-message macros can be a follow-up; do not refactor the entire MC8 message model now.

## Part C — Scene editor integration

Integrate the library into the **existing** scene workflow:
- For each MIDI-capable pedal in the scene, provide a discoverable **Add MIDI command** picker, favoriting frequently used commands at the top.
- Show command name, function, evidence, associated manual/page, and an exact PC/CC preview.
- Resolve the MIDI channel from the placed **device instance**, honoring existing overrides. Do not bake a global channel into a reusable profile command.
- If a command requires a value, offer a simple human-readable choice where documented and a precise numeric input for advanced use.
- Add the selected PC/CC into the scene's existing desired state and compile it through the **current** compiler and MC8 plan; existing numeric editing must continue to work.
- Handle conflicting assignments to the same CC or PC in one scene clearly. Do not silently produce contradictory instructions.
- Highlight commands with non-deterministic toggle semantics, undefined device MIDI capabilities, out-of-range values, or missing MIDI routes. Prefer actionable warnings over fabricated certainty.
- Expose a quick link from the Scene editor to the relevant document/page without leaving the user hunting for manuals.
- Ensure the Stage/scene report describes the chosen command and exact MIDI output clearly without implying physical device state has been verified.

**Reproducibility is nonnegotiable.** Define explicit semantics for changing or deleting a profile command after it has been used in scenes. Existing saved scenes must retain the actual wire-level PC/CC/bank/channel behavior and must not silently change merely because a command definition was renamed or edited. Prefer referencing stable command IDs *plus an intentional snapshot of applied values*; surface a "definition changed / review" warning when appropriate. The current compiled numeric values remain authoritative until a user deliberately reapplies or updates them.

## Product constraints

- Local first. Use the existing FastAPI/SQLite backend and Next.js frontend.
- Evolve schemas and migrations safely; preserve old rigs, profiles, uploaded images, cable assignments, board placements, mounting surfaces, and power data.
- Avoid increasing friction for a musician who wants to save two or three important MIDI commands and use them in a scene.
- Keep original Morningstar **MC8**, **ML10X**, and their evidence/firmware constraints intact. Do not claim native ML10X export or hardware synchronization.
- No Tone Recipe subsystem, DAW/audio import, live MIDI hardware communication, manual auto-search, or AI-based PDF extraction in this session.
- Update the existing evidence/provenance documentation with honest unknowns.

## Acceptance scenarios

Implement meaningful backend tests and Playwright browser coverage:

1. Upload a legitimate synthetic/test PDF to a custom/imported device; view and reopen it after reload.
2. Reject non-PDF payloads, oversized/unsafe files, and path traversal; remove a document without corrupting the profile.
3. Add a user-defined command, attach a manual/page citation, favorite it, edit it, and find it through the command picker.
4. Use a **CC** favorite in a scene: confirm target device, channel, CC number, value, compiler result, and MC8 switch plan.
5. Use a **PC** command, including correct zero-based wire value versus a one-based device display when applicable.
6. Show warnings for a toggle/unknown capability and refuse or flag invalid data without silently correcting to a made-up value.
7. Change a command definition after it has been used; verify the previously saved scene's exact compiled MIDI bytes do not change silently.
8. Save and reload; export and import an old rig that has no manuals/command favorites; export/import a newer rig retaining both command definitions and applied scene behavior. Missing document bytes must not crash.
9. Exercise the interface with an imported Pedal Playground profile that starts with no MIDI definitions. Let the user add a capability explicitly without falsely treating it as documented.
10. Verify regression tests for Board/Stage, power, mounting, wiring, and Morningstar compiler still pass.

Run backend tests, ruff, frontend lint/typecheck/build, and Playwright. Inspect screenshots of both device-document/command management and using a favorite command in the Scene editor.

## Delivery protocol

1. Reconnoiter the current implementation and write a brief execution plan before major edits. Choose the smallest compatible schema and UI changes.
2. Implement in tested, reviewable increments (manual storage, command definitions, scene picker/integration).
3. Record decisions, test evidence, limitations, and any deferred follow-ups in the Session 3 results (or a clearly linked short report).
4. Commit on \`experiment/session-3-freestyle\` and update draft PR #3; **do not merge**.
5. Make no claims of device/editor validation beyond actual evidence.

## Definition of done

A guitarist who knows a pedal's MIDI command from its manual can save that knowledge *once*, mark it as a favorite, and select it by name while building scenes—with a readable, accurate, persistent, reconstructable record of the commands the original MC8 is intended to send.
