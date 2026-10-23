# Signal Loom — Session 6 results: the MIDI Knowledge Workbench

> Implementation branch `feature/midi-knowledge-workbench`, started from `main` at `863d5ec`. Draft PR
> against `main`; **not merged**. The design checkpoint, the delivery report, the verification table,
> limitations and deferred items are all in one document:
> **[docs/midi-knowledge-workbench.md](docs/midi-knowledge-workbench.md)**.

In one paragraph: a musician opens a pedal's profile, presses **Knowledge Workbench**, and keeps the
manufacturer's PDF on the right while entering the pedal's MIDI controls on the left — number,
name, behaviour (continuous · discrete · toggle · trigger · unknown), value range, the PDF page it
comes from, and, separately and only by hand, whether it was tried on the real pedal. *Save & add
another* keeps the page open and the next row ready. **Quick Reference** notes (how to save a preset,
set the channel, startup shortcuts, fixes) take steps and page references and can be pinned; pinned
notes show up next to the placed pedal on the Board, where notes about *that one unit* live too.
Reviewed controls are offered by name in the Scene editor and labelled in the Texture picker;
proposals read from a page's text stay *proposed* until reviewed and are offered nowhere. Saved
scenes and textures never change when a control is edited, nothing in the workbench sends MIDI, and
project files carry the knowledge (and, on request, the cited PDFs).

Screenshots: [docs/screenshots/session-6](docs/screenshots/session-6). Register entries: S6-S01…S06,
S6-H01/H02 and F-Q08 in [docs/verification-register.md](docs/verification-register.md).
