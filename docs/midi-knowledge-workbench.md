# MIDI Knowledge Workbench — design and implementation plan (Session 6)

**Status:** design checkpoint written before implementation; updated at delivery with what shipped.
**Branch:** `feature/midi-knowledge-workbench`, from `main` at `863d5ec`.
**Scope source:** the Session 6 charter (musician-friendly reading of manufacturer documentation,
structured MIDI control definitions, pedal Quick Reference notes) and the backlog entries
*Official-manual MIDI mapping library* (F-Q08) and *UX-MANUAL-01* in `docs/future-features.md`.

## 1. Primary user journey

A guitarist has a new pedal and its manual. In the Device library they open the pedal's profile
and press **Knowledge Workbench**. The manual (uploaded once, as before) is on the right; on the
left are the pedal's MIDI controls. They search the manual for "MIDI implementation", turn to the
chart, and add controls one after another: CC number, name, what kind of control it is, the value
range, the page they are reading. Each control is saved as they finish it, the PDF stays on the
same page, and the next empty row is already focused. They switch to **Quick Reference**, write
down how presets are saved (steps, page reference), pin it, and leave. Later, in a Scene or a
Texture, the controls they entered are offered by name with their evidence, and the pinned
procedure is one click away from the pedal on the Board.

## 2. Main workspace layout

```
┌ app header ──────────────────────────────────────────────────────────────────────┐
│ ← Device library · Strymon Volante · effect · MIDI: din · ch 1 · PC 0–299 · Saved │  identity bar
├───────────────────────────────────────┬──┬───────────────────────────────────────┤
│  Controls | Quick Reference           │  │  [Volante manual ▾]  ‹ 12 / 44 ›  zoom │  reference toolbar
│  search…  [all][continuous][switches] │  │  find in document… ▸ hits             │
│  ┌ CC 12 Echo Level  continuous 0–127 │ d│  ┌─────────────────────────────────┐  │
│  │  documented · p. 12 · unverified   │ r│  │                                 │  │
│  ├ CC 15 Spacing     continuous 0–127 │ a│  │        page picture             │  │
│  ├ CC 102 Bypass     toggle           │ g│  │        (rendered PNG)           │  │
│  │ ▸ inline editor for the open row   │  │  │                                 │  │
│  └────────────────────────────────────│  │  └─────────────────────────────────┘  │
│  + Control                            │  │  PDF page 12 of 44 (printed numbers  │
│                                       │  │  may differ) · Cite this page        │
└───────────────────────────────────────┴──┴───────────────────────────────────────┘
```

- Route `/catalog/[id]/workbench` (a full-height workspace, not a panel inside the profile page).
- Left pane: Knowledge Editor, minimum 400 px. Right pane: Reference Viewer, minimum 360 px.
  A draggable, keyboard-operable separator (`role="separator"`, arrow keys) sets the split; the
  ratio is remembered per browser.
- Each pane scrolls on its own. Editing never navigates away: controls, notes, citations and
  uploads all happen in place.
- Below 1024 px the two panes become **Editor | Reference** segments; both stay mounted, so an
  open editor and the reading position survive switching.

## 3. Information hierarchy

1. **Identity bar** — pedal name, category, MIDI basics (interfaces, default channel, PC range,
   bypass CC) as read-only chips, save state, link back to the full profile.
2. **Controls** (default view) — one row per CC: number, name, behaviour chip (continuous /
   discrete / toggle / trigger / unknown), range, evidence chip, verification chip, source page
   link. Rows are compact; the editor opens inline under the row you are working on.
3. **Inside a control editor**, three tiers of disclosure: *What it is* (CC, name, behaviour,
   range) always visible; *Where it comes from* (document, page, note) one line below; *On your
   pedal* (hardware verification, manufacturer default vs your remapped configuration) last.
4. **Quick Reference** — pinned notes first, then by category; each note shows title, category,
   steps, references; the editor is inline.
5. **Reference Viewer** — document, page, zoom, find; the page picture; the PDF-page index with
   the explicit note that printed numbers may differ; *Cite this page* and *Suggest controls*.

## 4. Editing interactions

- **Add several controls in a row:** `+ Control` opens a blank editor focused on the CC number;
  *Save & add another* commits and opens the next blank editor with the same source document and
  page prefilled. Enter in a text field saves; Ctrl/⌘+Enter saves from anywhere; Esc cancels.
- **Cite the page you are reading:** the editor's *Use current page* button, or the viewer's
  *Cite this page* button, writes the open document and page into the open control or note.
  Clicking a row's `p. 12` link turns the viewer to that page without closing anything.
- **Behaviour and evidence are explicit:** behaviour defaults to *unknown*; evidence defaults to
  *documented* only when a citation is attached, else *user*. Hardware verification is a separate
  tri-state the user sets by hand (*not tested* / *verified on my pedal* / *did not respond*) with
  a free-text note; nothing in the app ever sets it. A control proposed from PDF text is
  *proposed* until a human marks it reviewed.
- **Manufacturer default vs your pedal:** a control is either the manufacturer's default mapping
  or *user-configured* (remapped on this unit), in which case the factory number is recorded.
- **Save model:** each committed control or note PUTs the whole list (one request); the identity
  bar shows *Saved · Saving… · Unsaved (open editor)*; leaving with an open editor asks first.
  Failures stay visible with the server's message and keep the draft.
- **Impact review:** the editor shows where a control is used (scenes with CC values on that
  number, Texture mappings) before it is renumbered or deleted; saved Scenes never change bytes.

## 5. Responsive behaviour

- ≥ 1280 px: two panes, default split 46 / 54.
- 1024–1279 px: two panes, default split 50 / 50, denser toolbar wrapping.
- < 1024 px: segmented **Editor | Reference**, single column, sticky identity bar; the page
  picture fits the width; toolbars wrap into two rows.
- 390 px: the control row collapses to two lines (number + name; chips on the second); the editor
  fields stack in one column; the viewer's find panel becomes a toggle.

## 6. Error, empty and loading states

- **No document attached:** the Reference pane offers *Upload PDF* in place, with the same
  validation as the library (content-checked, 40 MB).
- **Document not on this computer** (imported without files): message plus *Upload again*.
- **Page cannot be rendered / text layer absent:** message in the viewer with *Download PDF*
  and *Try again*; search reports "no text layer" instead of "no results".
- **No controls yet:** a short explanation and the two ways to start (`+ Control`, or *From the
  documented bypass/PC facts*); no empty table.
- **Loading:** the previous page picture stays visible until the next one has loaded (no flash);
  the controls list shows a skeleton only on first load.
- **Save failure:** inline, non-modal, draft kept.

## 7. Existing components reused or improved

- Reused: `Panel`, `Button`, `Badge`, `EvidenceBadge`, `Field`, `ErrorBanner`; the document
  page renderer and search endpoints; the library's upload/attach API; `orderedCommands` style
  filtering; the rig store for instance-level notes.
- Improved: `CommandPicker` gains a *Documented controls* list (reviewed controls applied as a
  CC value with the documented range); `PatchBay`'s destination picker shows behaviour and
  *needs review*; the Device library profile view gets the Workbench entry point and a compact
  controls summary; the Board inspector gets *Unit notes* and pinned model notes.

## 8. Data model (additive, no SQL migration needed)

Profiles and instances are stored as validated JSON (`device_profiles.data`, `device_instances.data`);
every change below is a new optional field with a default, so existing rows load unchanged.

- `CcDef` (the documented map the compiler, eligibility, panels and picker already read):
  `behavior` (continuous · discrete · toggle · trigger · unknown · None), kept in agreement with
  the existing `continuous` flag by a validator (continuous ⇔ True, discrete/toggle/trigger ⇔
  False, unknown/None ⇔ None), `min_value`/`max_value` (0–127), `citation`
  (`document_id`, `page`, `note`), `mapping` (manufacturer_default · user_configured) with
  `factory_cc`, `hardware_status` (unverified · verified · failed) with `hardware_note`,
  `review_status` (None = reviewed legacy entry · proposed · reviewed), `notes`.
- `DeviceNote` (new): `id`, `title`, `body`, `category`, `steps[]`, `references[]`
  (document citations), `evidence`, `source_note`, `pinned`, `created_at`, `updated_at`.
  `DeviceProfile.quick_reference: list[DeviceNote]` (model-level) and
  `DeviceInstance.quick_reference: list[DeviceNote]` (one physical unit).
- Eligibility: a `proposed` control is never eligible; toggle/trigger controls are refused as
  switches (through `continuous = False`); a Texture range outside a documented min/max is a
  warning.
- Compiler: a scene value outside a control's documented range → `midi.cc_out_of_range`
  (warning); a value on a proposed control → `midi.cc_unreviewed` (warning). Bytes unchanged.
- `commands_from_midi_spec` copies a control's citation into the derived command and skips
  proposed controls.
- Project files: unchanged format; new keys are omitted from the file when they hold their
  defaults (as `textures` already is), so a plain export of a profile without new knowledge still
  opens in the previous app version. Complete backups carry the cited PDFs as before.

## 9. API

- `PUT /api/catalog/devices/{id}/controls` — replace only `midi.cc_map` (guarded while the
  performing rig uses the profile, like commands).
- `PUT /api/catalog/devices/{id}/quick-reference` — replace only the profile's notes.
- `GET /api/catalog/devices/{id}/control-usage` — per CC: scene values and Texture mappings
  that use it (impact review).
- `GET /api/documents/{id}/pages/{n}/proposals` — controls proposed from the page's text layer
  (regex over "CC 12 … name" patterns; every proposal is `review_status = proposed`, cites the
  page, and is never added without the user's action). Secondary; must not delay the above.

## 10. Verification plan

- Backend: model rules, controls/notes endpoints, usage report, eligibility and compiler
  diagnostics, from-map citation copy, export/import round trip incl. compatibility scrub,
  proposals parser, legacy profile load.
- Browser (Playwright): the acceptance journey of charter §8 on a profile copy with a synthetic
  three-page "manual"; narrow-screen segment switching preserving an open editor; screenshots at
  1440 / 1280 / 390 px for the delivery report.
- Visual pass over the screenshots before the PR.

## 11. Out of scope (documented as follow-ups)

Automatic extraction beyond the page-text proposal; PDF annotation; semantic search; rich note
formatting; contextual display of a preset-saving note inside the preset editor (data is ready);
any MIDI transmission, hardware configuration or preset write.
