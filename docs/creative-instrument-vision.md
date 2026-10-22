# Signal Loom — Creative Instrument Vision

**Status:** Enduring product direction; not a claim that every feature below is implemented.  
**Recorded:** 2026-10-21 (consolidating the October 18–21 product conversations).  
**Companion execution plan:** [Session 5 Charter](../SESSION-5-CHARTER.md).  
**Existing foundation:** Sessions 1–4 on main; real MIDI interaction verified on the owner's rig.

## The product we intend to build

**Signal Loom is a creative environment that understands the rig, not a rig manager with creative features.** The physical pedalboard is a single, expressive, programmable musical instrument. The app does not produce, model, or reverse-engineer the sound; the *real pedals* make the sound. Signal Loom exposes a deliberate, legible, musically coherent control surface across them.

The inspiration is the feel and discoverability of a sophisticated modular synthesis environment (especially Arturia Pigments), *not* an imitation of its synthesizer engine or UI: source → modulation → destinations, clear macro routing, visible interaction and movement, continuous musical exploration. A musician should think **"make the delay bloom while the pitch rises and the drive falls"**, not **"send CC 15 on channel 7, then open the next device editor."**

**Wire once, reach everything** remains the infrastructure rule. A computer USB cable into the original Morningstar MC8 can reach the owner's actual MC8 DIN/Omniport MIDI network; hub and mixed arrangements are also valid when modeled and verified. Never promise protocols that cannot traverse a hop. Standalone MC8 operation, independent of the computer, must remain a first-class use case.

**Creative freedom sits on top of known constraints.** Pedal capability, preset inventory, device-specific MIDI maps, the routed connections, collision scope, power and port identity, state confidence, traffic capacity and actual physical behavior must constrain what the instrument lets the musician do. Unknown is not verified. Sending is not receiving. A virtual performance is not physical evidence.

## Who it is for

Primary persona: **one experimental guitarist/composer** with a changing, mixed-brand MIDI pedalboard; may record alone, build evolving drones, textures, psychedelic sounds, ambient washes, shoegaze-like swells, rhythmic effects, or abrasive guitar parts, and later perform them in a band. Most valuable qualities: immediacy, happy accident, expressive control, reproducibility, low administrative friction, and truthful feedback.

The product should also be **modularly useful**: board planner, scene manager, MIDI command librarian, musical instrument and Experiment Lab must each create value without forcing a complete ecosystem adoption. Wider multi-musician collaboration may arrive later, including a distinct Shared Looper project.

## The conceptual hierarchy

Do **not** make the pedal brand, the controller preset or even the static Scene the musician's top-level creative object.

1. **Rig / Device / Profile / Connection:** What physically exists and what can reach what. Stable authoritative engineering facts, with source/evidence and unknowns.
2. **Scene:** A repeatable *discrete intent* for routing, preset recall, bypass and CC settings. Existing compiler and persistence remain canonical for scene behavior. Scene selection by itself does not transmit MIDI.
3. **Texture:** A **first-class musical idea**: a name, descriptive sonic intent, optional starting scene, playable macros, modulation routings, tempo context and authored notes. A texture can be meaningful without a fixed song section or a particular MC8 button. It references rig instance IDs, not copies of pedal definitions.
4. **Movement:** How a texture develops through time; rhythms, evolving modulation depths, gestures, envelopes and changes. Future structured object, distinct from a preset recall. May include authored and recorded performances.
5. **Transition:** An intentional move from one texture/movement to another. Different parameters can travel independently, sometimes in opposing directions or with offsets. A MIDI pedal may only jump presets; never depict jumps as audio crossfades.
6. **Performance / Composition:** A sequence or network of musical ideas, cues, live interventions and transitions. Song/setlist integration can reuse the existing Stage but should not force verse/chorus/outro semantics on experimental music.

Session 5 makes **Texture** useful as the first playable object and defines the necessary seams for the remaining concepts. Do not generate empty placeholder models for every future tier merely to check conceptual boxes.

## The musician-facing instrument

A **whole-rig instrument** view presents *functions* and *musical relationships* instead of siloed vendor panels: source/drive, dynamics, pitch/harmony, modulation, delay, reverb, looper/sampler, space/texture and output/routing. This classification is a customizable organizational lens, not a hardwired signal-flow assumption. Each visible module names its real pedal(s), verified MIDI controls, reachable route, assigned MIDI channel and limitations. Multiple pedals can occupy one family; a pedal can serve multiple functions.

A modulation **patching view** is legible without hunting through tables: macros, tempo source, LFOs and eventual envelopes/step modulators visibly connect to parameter destinations. A connection displays direction, depth, independently chosen output range, value/shape constraints and evidence. Example: a single "Undertow" macro simultaneously pushes delay mix up, rolls drive down and increases pitch interval within permitted ranges. Destinations don't need to share a MIDI number or physical unit.

**Global tempo** is a creative reference used to derive modulation periods (e.g. beats/divisions); it does not silently transmit MIDI Clock or change every pedal's BPM. A future documented Clock module can provide external synchronization after explicit hardware and jitter validation.

Modulation is **predictable**: deterministic source evaluation, bounded and scaled destinations, phase/rate/depth controls, visible indication of effective value, a preview with **zero sends**, and controlled physical output only with deliberate arming/start. Tempo-synced movement should not rely on browser paint timing. Real hardware is not a sample-accurate synthesizer; excessive CC traffic, missing interpolation, driver delays, state-dependent effect behavior and control quantization must be made visible.

A future expressive input layer can map **one physical expression pedal, MIDI controller or footswitch to different meanings per texture**, including simultaneous parameter mappings. The owner currently uses every original MC8 Omniport for pedals; do **not** assume a free Omniport or an MC8 Pro. Potential input routes include relocating devices via the Meris MIDI I/O or a separately connected DIN/USB expression source. Confirm real directionality and capabilities rather than inventing compatibility.

## Exploration and musical memory

**Experiment Lab** is a dedicated, visibly separate environment for serendipitous combinations. Its origin: during actual MC8/ML10X testing, loosely combined PC recalls created genuinely interesting whole-rig sounds by accident. Deliberate randomization of known eligible presets should make this discoverable, with individual device locks, bounded candidate sets, explicit auditions, a discovery journal, one-click *capture as a new idea/scene*, and best-effort restoration only where enough is known.

**Experimentation must never leak into regular management, verification or performance.** No random MIDI messages on scene selection, no memory writes, no random SysEx, no silent changing of critical settings. A restore snapshot is a record of *known commanded state*, not proof of pedal state. Preserve user-verified facts and warnings.

For future first-time setup, a **known-vs-unknown device-state** workflow should collect MIDI channels, documented CC semantics, preset inventories and slots, user/factory/empty classification, manual evidence, and optional *read-only* identity/preset queries where explicitly supported and authorized. Do not pretend a generic pedal replies or that outbound PC is a preset dump. Persistent profiles/libraries could provide a Git-like history of verified changes, scene intent and sonic notes; administration should be nearly invisible during creative play.

A future integration with **Shared Looper** can play an uploaded guitar fragment or isolated sample through the actual rig to audition textures while adjusting the controller. Uploaded MP3/audio clips may be linked to musical ideas as references. Captured audio is not proof of preset values and does not turn this into neural tone reconstruction or a cloud audio-generation platform.

## The experience we are optimizing

Opening the app should feel like **approaching an instrument**, not reading a maintenance report. Rapidly explore with a large gesture/macro, see exactly *what it controls*, turn musical movement on/off, save a meaningful idea, return later and understand why it sounded interesting. Intuitive layout, immediate visual feedback, clear unavailable controls, safe defaults, minimal modal friction and obvious stop/disarm are more valuable than many knobs.

The musician should be able to create evolving swells, deliberate opposition between pedal parameters, tempo-related pulses, complex slow shifts, hands-free controller gestures and eventually arranged transitions. Keep the interface usable on modest screens and with keyboard interaction; accessible controls and reduced-motion fallbacks matter.

Examples of future musical ideas:
- **Undertow:** drive decreases as delay mix grows, while a long, tempo-related modulation slowly changes a second parameter.
- **Fracture:** harmonic/pitch color deepens while space contracts, later moving abruptly into an intentionally different state.
- **Starlight Drift:** a slow texture with multiple synchronized but independently scaled motions; nothing implies that physical pedals support arbitrary interpolation.

## Safety, trust and explicit truthfulness

- Normal planner operations, opening a texture, editing a mapping, changing tempo and previewing modulation are always **non-transmitting**.
- Only documented or user-authorized, **repeatable and deterministic** controls may be modulated continuously. Arbitrary numerical CC slots are not safe. Disallow bank select, preset writes, resets, vendor-global settings and other hazards unless a later separately reviewed adapter explicitly permits a particular control.
- A live performance requires a connected local backend, open eligible routes, explicit arming and **separate intentional Start**; Stop/Disarm/port loss/backend shutdown cancels future commands. Closing the controlling browser must not cause unattended indefinite modulation.
- Protect each device and the whole bus with a documented message budget, last-value coalescing, deduplication, safe value bounds and scheduler overload handling. The algorithm must be measurable and testable under simulated clock and transport failures.
- Show **modeled intention**, **last sent**, **observed input** and **user hardware verified** independently. Never invent device readback or promise atomic rollback of a changing pedalboard.
- Preserve local-first design, offline planner, rig IDs and documents, revision-safe saving, external editor handoff, and no mandatory service, credentials, or telemetry.
- Avoid storing secrets or private sample/audio/media in Git. Respect device-manual copyright and asset licenses.

## Development trajectory (direction, not delivery commitments)

**Session 5 — First playable whole-rig instrument.** One durable Texture, two-device macro with independent scaling/opposition, one tempo-related modulation path, transparent virtual audition, conservative backend-owned live control, Start/Stop and capture/safe persistence. One complete end-to-end musical interaction beats many decorative modules.

**Subsequent sessions (not ordered commitments):**
- Deeper modulation patchbay: more sources/shapes, envelopes, automation lanes, phase relationships, per-texture expressive MIDI input mapping, sample-accurate-enough intent visualization (not invented hardware precision), tempo/Clock validation.
- Musical movement and transition engine: captured gestures, parameter ramps, scene transitions with device-specific jump/hold limits, textures and arrangements; meaningful reusable compositional artifacts.
- Explicit Experiment Lab with safe PC shuffle, lock-and-explore, provenance journal, cautious state restoration and optional capture into textures.
- Device-knowledge/onboarding: preset inventory certainty, manual-assisted mapping, read-only queries where supported, safe slot management, evolving verified history.
- Shared Looper and audio audition, performance-oriented control surfaces and eventual hardware/controller integrations.

A future feature is **not** authorized to transmit merely because it appears here. The implementation gate is the active Session charter, CI/review and ultimately owner-led physical verification.

## Product success test

Can a guitarist cable the board once, open a named musical Texture, see the real pedals grouped as a cohesive instrument, assign **one gesture to multiple documented CC targets**, preview the behavior without touching hardware, deliberately perform a slow tempo-related movement through the safe live layer, stop it instantly, and return to the exact authored idea later?

If so, Signal Loom has crossed from *managing a rig* toward *playing the rig* without giving up truth or control.
