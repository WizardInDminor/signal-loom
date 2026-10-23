import type { SourceCitation } from "@/lib/types";

/** What the Reference Viewer is showing. Owned by the Workbench so an editor can cite it and a row can turn to a page. */
export type Zoom = "fit" | 700 | 1000 | 1400;
export interface ReferenceState { docId: string | null; page: number; zoom: Zoom }

/** "Cite this page" pressed in the viewer while a control or note editor is open. `seq` makes every press distinct. */
export interface CiteRequest { citation: SourceCitation; seq: number }
/** "New control / note from this page" pressed in the viewer. */
export interface Spawn { kind: "control" | "note"; citation: SourceCitation; seq: number }

export type SaveState = "saved" | "saving" | "error" | "editing";
