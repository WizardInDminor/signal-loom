// Mounting surfaces. A device is on top of the board, under it, or off the board. Rigs saved
// before surfaces existed only carry `off_board`; `surfaceOf` honours that without rewriting it.

import type { DeviceInstance, Surface } from "./types";

export const SURFACES: Surface[] = ["top", "underside", "off_board"];

export const SURFACE_LABEL: Record<Surface, string> = {
  top: "Top of board",
  underside: "Underside",
  off_board: "Off-board (guitar, amp, floor)",
};

export const SURFACE_SHORT: Record<Surface, string> = { top: "top", underside: "underside", off_board: "off-board" };

export function surfaceOf(inst: Pick<DeviceInstance, "off_board" | "surface">): Surface {
  if (inst.surface) return inst.surface;
  return inst.off_board ? "off_board" : "top";
}

/** Set a device's surface, keeping the legacy flag in agreement (the server does the same). */
export function setSurface(inst: DeviceInstance, surface: Surface): void {
  inst.surface = surface;
  inst.off_board = surface === "off_board";
}

/** The two board surfaces share one coordinate system; a cable between them has no modelled route. */
export function crossesSurfaces(a: Surface, b: Surface): boolean {
  return a !== b && a !== "off_board" && b !== "off_board";
}
