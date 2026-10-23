# Instrument Studio — authoring a Texture as an instrument (Team A, A-02)

> Design checkpoint first (§1–§10), delivery report after (§11 onwards). Branch
> `feature/instrument-studio` from `main` at `34bdc7f` (Session 6 merged). Nothing here transmits
> MIDI, adds a message type, a modulation source, MIDI Clock, SysEx or a preset write; the Texture
> model, the evaluator and the performance engine are unchanged. Morningstar and live-engine code is
> not touched.

## 1. The journey this must make easy

A guitarist opens an existing Texture ("Undertow") on their rig. They know *what* they want: "the
echo should swell while the drive backs off". They do not know, and should not need to know, that
the Volante's echo level is CC 12 on channel 3. They:

1. see the rig as an instrument — the pedals grouped by what they *do* in this idea (drive, delay,
   space…), each with the controls the manual documents;
2. **find a control by its musical name** ("echo", "mix", "decay") or by the pedal it lives on, and
   see at once whether it is a sweep (mappable), a switch (not a sweep), still *proposed* from a
   manual page (not yet reviewed), or simply *not stated* (mappable only with their own declaration);
3. **map it to the macro** with one click: the destination appears with the documented range as
   its default extent, rising with the macro;
4. **understand direction and extent** from the picture, not from two numbers: a rail from 0 to
   127 with the documented range shaded, the authored span drawn as an arrow (blue rises, amber
   falls), a cursor that follows the macro, and one *Flip* button for the inverse gesture;
5. **preview** by moving the macro (mouse, touch or arrow keys) and switching the triangle LFO on,
   watching every destination's value move — with the state bar still saying *PREVIEW — nothing is
   transmitted*;
6. **save and reopen**: everything is an ordinary rig edit (undo, revision, debounced save); after a
   reload the same cords, ranges and values are there.

The existing form (device select → "CC 100 · Expression · continuous" → From/To numbers) stays
reachable as *Any CC number…* for a control the manual does not list yet, but it is no longer the
front door.

## 2. Layout

```
┌ Textures ─┐ ┌ 1 · What am I playing? ─────────────────────────────────────────────────┐
│ Undertow  │ │ name · intent · starts from scene · tempo · notes                          │
│ + New     │ └─────────────────────────────────────────────────────────────────────────┘
│           │ ┌ 2 · The patch — what moves what ────────────────────────────────────────┐
│           │ │ THE RIG BY FUNCTION  [Drive: Sunset] [Delay: Volante ✓ suggested…] [Other: Hedra → Pitch? Use · Keep] │
│           │ │ ┌ SOURCE ───────┐           ┌ DESTINATIONS ───────────────────────────┐ │
│           │ │ │ Bloom          │ ═══╗      │ Volante · Delay · ch 3 · route unreachable│ │
│           │ │ │ ▁▂▃▅▆ slider   │    ╠════▶ │  Echo Level  CC 12   documented · p. 7   │ │
│           │ │ │ effective 59%  │    ║      │  0 ░░░░▓▓▓▓▓▓▶▓▓▓░░░ 127   value 61      │ │
│           │ │ │ ◯ LFO 8 beats  │    ║      │  from 40 to 70 · Flip · documented · full │ │
│           │ │ │ depth 25%      │    ╚════▶ │ Collider · Delay · ch 4                   │ │
│           │ │ └────────────────┘           │  Delay A Mix CC 3  ◀▓▓▓▓ falls 95 → 65    │ │
│           │ │ [+ Add a destination to Bloom]  → Control finder (search · function chips · list) │
│           │ └─────────────────────────────────────────────────────────────────────────┘
│           │ ┌ 3 · What is happening? (unchanged) ─────────────────────────────────────┐
```

- **Source column** (left, ≈ 260 px on desktop): the macro card — name, the large slider, the
  effective value, the triangle LFO (on/off, cycle in beats, depth), period/phase readout and the
  phase ring. Moved here from section 1 so the *source* sits beside its *destinations*; the
  controls and their test ids are the same ones Session 5 shipped.
- **Cords**: an SVG layer between the columns draws one cord from the macro's port to each
  destination card's port. Colour = direction (accent blue rises with the macro, amber falls),
  dotted grey when the destination is disabled, red when it conflicts with another destination or
  is refused. The dash drifts while the preview value moves; static under reduced motion.
- **Destination cards** (right): grouped by pedal (label, function chip, channel, CC-route status
  from the live layer). A card is the Session 5 mapping row redrawn around the rail: the control's
  documented *name* first, the CC number small and monospaced; badges for behaviour (continuous /
  switch / not stated), evidence, the cited page, hardware status (✓ verified on hardware, or
  *not tried*) and review state (*needs review*); the live value large; the rail; *from / to*
  inputs; **Flip**; *Documented range* / *Full range* shortcuts; then exactly the reason, warnings,
  conflict and declaration affordances the backend already reports (unchanged wording).
- **Control finder** (opens inline under the destinations, never a modal): a search field, function
  chips, and the controls of every MIDI-capable pedal of the rig grouped by function → pedal. Each
  row: name, CC, behaviour, documented range, evidence, page, hardware status, *mapped* if already
  a destination, and a **Map** button. Switches, bank/channel-mode CCs, bypass CCs and *proposed*
  controls show the reason instead of a Map button; *not stated* controls can be mapped and say that
  a declaration will be asked. Footer: *Any CC number…* (the old form, compact) and a link to the
  pedal's Knowledge Workbench for documenting more.
- **The rig by function** keeps its strip above the patch (same test ids). A device that would land
  in *Other* carries a **suggestion chip**: the role, its basis in words (the model name, or the
  documented control names such as "Echo Level"), and *Use* / *Keep Other*. Both are the user's
  stored decision (`function_roles`), so the app never regroups silently and never claims audio
  topology.

## 3. Responsive behaviour

- ≥ 1280: source column + cords + cards, finder opens beside the cards' column width.
- 1024–1279 (small laptop): the same, with tighter cards (badges wrap, rail full width).
- < 768 (phone): the source card stacks above the destinations; cords are hidden (they would cross
  stacked cards) and the direction lives in the rail's arrow, colour and sentence ("falls 95 → 65
  as Bloom rises"); the finder is full width; every target is at least 32 px tall.

## 4. Interaction details

- **Map**: adds `{instance_id, cc, output_min, output_max}` with the documented min/max as the
  extent (0–127 when not stated), rising, enabled; focus moves to the new card's *from* field.
- **Flip** swaps `output_min` and `output_max` — the inverse gesture is one gesture, not two typed
  numbers. The sentence under the rail and the cord colour change immediately.
- **Documented range / Full range** set the extent to the profile's `min_value–max_value` / 0–127.
- The *from*/*to* inputs keep their labels (*Output min* / *Output max*), clamp to 0–127, and the
  rail follows on every keystroke.
- Moving the macro updates every card's value and cursor on every frame (4 Hz under reduced
  motion) through the existing preview clock; nothing is sent.
- **Suggestion chips**: *Use* writes the suggested role; *Keep Other* writes `other` explicitly so
  the chip stops asking. Any device can still be relabelled with its select.
- Keyboard: the slider takes arrow keys/Home/End; the finder's search field, chips, rows and Map
  buttons are ordinary focusable controls; Escape closes the finder and returns focus to the
  *Add a destination* button; after Map the finder stays open (add two or three in a row).
- While performing (`structuralLocked`): Map, Flip, range inputs, remove and suggestions are
  disabled exactly as the mapping fields were (the engine's guard is unchanged).

## 5. What is deliberately *not* hidden

- An unreachable route, an unverified hop, a *not hardware-verified* control, a *proposed* control,
  a conflict, a missing device or scene and a refused CC are shown on the card and in the finder
  with the backend's own reason text. Visual polish never replaces those words.
- "Asked now" (this screen's evaluation) and "last commanded" (the backend's) stay separate in
  section 3; cards show only the asked value and say so in their tooltip.
- A suggestion is labelled *suggested* with its basis; grouping is an organisational lens, never
  a statement about audio routing (the strip's caption says so).

## 6. Data model and backend

No schema change, no migration, no new endpoint. `Texture`, `Macro`, `Mapping`, `Lfo` and
`function_roles` are used as they are; `CcDef`'s Session 6 fields (`behavior`, `min_value`,
`max_value`, `citation`, `hardware_status`, `review_status`, `mapping`) are *read* for display and
defaults. Eligibility remains the backend's verdict (`analysis.textures`); the finder's client-side
classification only decides what to *offer* and always defers to the row's backend verdict once it
arrives.

## 7. Components

- `components/instrument/MacroSource.tsx` — the macro card (moved out of `TextureHeader`).
- `components/instrument/DestinationCard.tsx` — one mapping as a card with the rail.
- `components/instrument/ControlFinder.tsx` — search, chips, grouped controls, Map, advanced entry.
- `components/instrument/PatchCords.tsx` — the SVG cords (measures ports with a ResizeObserver).
- `components/instrument/PatchBay.tsx` — orchestration: function strip with suggestions, source
  column, destination groups, finder.
- `lib/instrument.ts` — `suggestRole`, `classifyControl`, `defaultRange`, `directionText`.
- `TextureHeader.tsx` keeps name, intent, scene, tempo, notes; `PerformancePanel.tsx` unchanged.

## 8. States

- No MIDI-capable device: the finder says so and links to the Board; the source card still works
  (nothing to map).
- No documented controls on a pedal: its finder group says "No documented controls yet — open the
  Knowledge Workbench" with the link; *Any CC number…* remains.
- No destination on the macro: a dashed placeholder card explains what a destination is and opens
  the finder.
- Device or scene missing: unchanged red states from Session 5.

## 9. Accessibility and motion

Every control is a native element with a label; the rail is `aria-hidden` and its meaning is
repeated in text; cords are decorative (`aria-hidden`); the live value has `aria-live="off"` (it
changes every frame); the finder is a `region` with a labelled search; chips are toggle buttons
with `aria-pressed`. Reduced motion: no cord drift, no cursor transition, 4 Hz numbers.

## 10. Verification plan

- `e2e/instrument-studio.spec.ts`: a real rig whose pedal profile copy carries documented controls
  entered the Session 6 way (continuous *Echo Level* cited p. 7, a *Mix* control, a *Tap* trigger, a
  *proposed* control, a *not stated* control); open the texture; search "echo"; Map; the card shows
  the name, page and *not tried on hardware*; the range defaults to the documented range; Flip
  inverts; the preview values move with the macro while `sent|queued` stays 0; the switch and the
  proposed control have no Map button and say why; the *Other* device shows a suggestion whose
  basis names the control, *Use* regroups it and the rig saves it; reload keeps everything; phone
  width with reduced motion has no horizontal overflow and the direction sentence is visible.
- `e2e/instrument.spec.ts` (Session 5): kept, with its add-form steps redirected through the
  finder's *Any CC number…* path and the moved macro's test ids; every safety assertion unchanged.
- Screenshots at 1440, 1280 and 390 in `docs/screenshots/session-7/instrument-studio-*.png`.

---

# Delivery report

## 11. What shipped

- **The patch** (`PatchBay.tsx`): per macro, the source card (`MacroSource.tsx`: slider, effective
  value, triangle LFO, phase ring, all the Session 5 controls and test ids) on the left, cords
  (`PatchCords.tsx`, measured from `data-port` elements, re-measured by a ResizeObserver; accent =
  rises, amber = falls, dotted grey = off, red = refused or in conflict; the dash drifts while the
  LFO is on, static under reduced motion, hidden below `md`) and the destinations on the right,
  grouped by pedal.
- **Destination cards** (`DestinationCard.tsx`): the control's documented name first, the pedal,
  the CC and channel in monospace; badges for eligibility (the backend's verdict), the documented
  range, the cited page, hardware status (*✓ verified on hardware* / *failed on hardware* / *not
  tried on hardware*), review state and the CC route; the rail (documented range shaded, authored
  extent as a directional bar, live cursor); the direction in words (`rises 10 → 120 as Bloom
  rises`, `falls 127 → 0 as Bloom rises (inverse)`); *from / to*; **⇄ Flip**; *documented a–b* and
  *full 0–127* shortcuts; then the unchanged reason, warnings, conflict and declaration affordances.
- **Control finder** (`ControlFinder.tsx`): search by name, pedal, function or `cc n`; function
  chips; groups by function → pedal; per control the name, CC, offer (*sweep* / *not stated* /
  the refusal reason in words), range, evidence, page, hardware verification and *mapped*; **Map to
  Bloom** adds the destination with the documented range as its extent; *Any CC number…* keeps the
  Session 5 form for a control the manual does not list yet; a link to the pedal's Knowledge
  Workbench per group. Escape or *Close* returns focus to *+ Add a destination*.
- **Grouping suggestions** (`lib/instrument.ts::suggestRole`): a pedal the heuristics would file
  under *Other* carries a chip naming the suggested function and its basis (a curated model-name
  hint such as “Volante (a tape echo)”, else the first documented control whose name says what the
  pedal does, e.g. “Echo Level”); *Use* and *Keep Other* both store the user's decision in
  `function_roles`; nothing is regrouped silently and the strip's caption says grouping is not the
  audio path.
- `lib/instrument.ts` also gained `classifyControl` (the client-side mirror of the backend's
  eligibility rules, used only to decide what the finder offers), `defaultRange`, `directionText`
  and `controlOf`. `TextureHeader.tsx` keeps name, intent, scene, tempo and notes.
- Backend, model, evaluator, performance engine, Morningstar and live code: **unchanged**. No
  migration, no new endpoint, no new MIDI message type; the tab still transmits nothing until the
  Session 4/5 connect → arm → Start gesture.

## 12. Verification

- `e2e/instrument-studio.spec.ts` (new, 2 tests): the journey of §1 on a real rig (a Volante profile
  copy with a cited continuous control with a documented range, a continuous control without, a
  trigger, a *proposed* control and a *not stated* control, entered through the Session 6 controls
  endpoint) — suggestion chip with its basis → *Use* regroups; finder search “echo” → one control
  with name, range and page → Map; card shows *documented continuous*, *not tried on hardware*,
  *p. 2*, the backend's *not hardware-verified* warning, `rises 10 → 120 as Bloom rises`; the
  trigger and the proposal have no Map button and say why; the *not stated* control says a
  declaration will be asked; chips narrow the list; second destination → Flip → `falls 127 → 0 …
  (inverse)`; Close returns focus; two cords with the right tones; macro End/Home moves the values
  120/0 and 10/127 while `sent|queued` stays 0 and the state bar says PREVIEW; the rig saves
  `function_roles` and both ranges; reload shows the same. Phone (390 px, reduced motion): *Keep
  Other* remembered, map by search, Flip, cords hidden, no horizontal overflow, keyboard macro.
- `e2e/instrument.spec.ts` (Session 5, 4 tests): kept; the add-form steps go through the finder
  (one-click Map for the documented BigSky control, *Any CC number…* for the undocumented Sunset
  CC 100 and the bypass CC 15), and the moved macro's assertions point at the source card. Every
  safety assertion is unchanged: refused unknown CC, refused bypass with no override offered,
  conflict detection and repair, declaration with a note, zero sends, scenes untouched, connect →
  arm → Start → bounded virtual stream → Stop, second tab, lease, reload starts nothing.
- Full Playwright suite on this branch: **54 passed**; `npm run lint`, `npm run typecheck` clean.
- Screenshots: `docs/screenshots/session-7/instrument-studio-{1440,1440-finder,1440-suggestion,1280,390,390-finder}.png`.

## 13. Known limitations

- One macro per texture is still the authored norm; the UI draws every macro the model holds but
  creates only the first (unchanged from Session 5).
- Suggestions come from a short curated model-name table and from documented control names; a
  pedal with neither stays *Other* with no chip. The table is a list of musical-function hints,
  deliberately not a capability database.
- The finder offers what the client can tell from the profile; the backend's verdict on the card
  remains authoritative and may differ for a control the client could not classify (it then shows
  the backend's reason exactly as before).
- Cords are measured from the DOM; they are decorative, hidden on phones, and never carry
  information the rail and the sentence do not also show.
- The offline *Not yet controllable* notice in section 3 still appears for a texture with no
  destination at all (Session 5 wording); it disappears with the first eligible destination.

## 14. Product-owner decisions

- Whether the curated model-name hints should live in the repository (as now) or in the
  user-editable profile (a `function` tag the Device library could edit) — the latter would make
  the owner's own catalog self-describing without code changes.
- Whether a mapping should snapshot the control's name at map time (`Mapping.label`, unused today)
  so a later rename in the Workbench is visible on the card as “was: …”.

## 15. Recommended next work

1. Per-texture expressive input (one physical expression pedal or MC8 switch steering a macro) —
   the vision's next step after a legible patch; needs the live layer, so a separate charter.
2. Macro drag undo coalescing (F-Q02) now that the macro is the centre of the patch.
3. Owner validation on the real rig: open the restored Undertow, map Volante *Echo Level* and
   Collider *Delay A Mix* from the finder, confirm the page citations and hardware statuses match
   the Workbench, and record S7 rows in the verification register.
