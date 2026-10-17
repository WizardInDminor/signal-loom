# Session 3 direction — the Stage

**Branch:** `experiment/session-3-freestyle` · **Baseline:** `main` at e3e90ac (Sessions 1 + 2 merged, 64 backend tests, 20 browser scenarios green).

## The one experience to transform

Signal Loom already knows more about a rig than any pedalboard planner: true-scale enclosures,
every jack's position, which conductor of which TRS jack a cable uses, how an ML10X preset routes
Tip and Ring through those jacks, what the MC8 sends and over which MIDI cable, and what the
musician still has to do by foot. Today all of that is shown as **tables**. The Scenes tab is a
form; the compiled plan is a grid of numbers; the signal path is a sentence. A guitarist cannot
*see* what pressing switch B does to the board under their feet.

Session 3 builds the **Stage**: a scene-first, physical-first view of the rig.

Pick a scene (click it, or step through the setlist with the arrow keys as you would on stage)
and the actual pedalboard comes alive:

- The **left and right signal paths** are drawn as animated flows along the *real cables between
  the real jacks* (Guitar → ML10X Input Tip → Send C Tip → BigSky IN L → OUT L → Return C Tip → Output
  Tip → Amp L; the Ring path separately in its own hue), with the virtual hops inside the ML10X
  drawn dashed so the user can tell cable from preset. A bypassed loop routes *around* the pedal;
  an empty loop is visibly empty; a broken loop ends the flow where it breaks.
- Every pedal shows its **scene state** as an LED: engaged, bypassed, or "not set in this scene";
  devices outside the scene's path fade. Loop state (ML10X) and pedal state (the pedal's own
  bypass) stay two different facts, because on an analog pedal they are.
- The **MC8 face** shows the bank and the switch that recalls the scene (bottom row A–D, top row
  E–H; page 2 for I–P); the scene's MIDI messages travel as pulses along the **real MIDI cables**
  (DIN, Thru, Omniport TRS) to the devices they reach, and devices the MC8 cannot reach are flagged.
- A short **story** replaces the table: "Switch A → ML10X ch 10: bank 1, preset 0 'Clean stereo'
  · Sunset ch 3: bypass · BigSky MX ch 2: program 0, engaged · Plumes: no MIDI, step on it".
- Stepping to the next scene shows **what changes**: pedals that flip, loops that engage or bypass,
  paths that move, messages that differ. The board animates the transition.

## Why this matters

It turns the model's rigour into something a musician reads at a glance, and it is a *test* of the
model: if the Stage draws a path that doesn't match the cables and the preset, something upstream is
wrong. Nothing in the Stage is a new claim about hardware; every pixel is derived from facts the
rig already stores, and estimated jack positions stay dashed.

## Supporting refinements (small, in the same spirit)

- Rig cards on the home page show a **true-scale miniature** of each board so a rig is recognisable
  before it is opened.
- Workspace tabs are deep-linkable (`#stage`), so a setlist can be bookmarked.
- The board's device glyphs get an enclosure look shared with the Stage.

## How I will know it worked

- A browser scenario opens the stereo demo on the Stage, sees a left path of the expected physical
  cables and a right path that starts at Return C Ring, steps to the next scene with the keyboard,
  and sees the lit MC8 switch, the pedal LEDs and the change list update, with nothing saved
  (the Stage is read-only).
- Backend tests prove each traced step names the physical cables and ML10X jacks it uses, and that
  MIDI routes list the cables from the MC8 to each reachable device.
- Screenshots of the Stage on both demo rigs, reviewed for legibility.
- Every Session 1/2 check still passes: 64 pytest, lint, typecheck, build, 20 Playwright scenarios.

## Not doing

Native ML10X export (still blocked), hardware writes, device photography, a visual Advanced-mode
editor (the Stage *reads* Advanced presets; authoring them stays with Morningstar's editor).
