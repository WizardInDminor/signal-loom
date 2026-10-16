"""Board geometry: footprints, rotation, bounds, overlaps and absolute port coordinates.

All coordinates are millimetres in board space, origin at the board's top-left corner,
x to the right and y "down" (towards the player). An instance's ``x_mm``/``y_mm`` is the
top-left corner of its rotated bounding box.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..models.board import PedalboardSpec
from ..models.common import Diagnostic, Edge, Evidence, Severity
from ..models.profile import DeviceProfile, PortDef
from ..models.rig import Board, DeviceInstance, Rig

# Used when a profile's footprint is unknown so that it is still placeable and visibly flagged.
PLACEHOLDER_W_MM = 70.0
PLACEHOLDER_D_MM = 120.0


@dataclass(frozen=True)
class Rect:
    x: float
    y: float
    w: float
    h: float

    @property
    def x2(self) -> float:
        return self.x + self.w

    @property
    def y2(self) -> float:
        return self.y + self.h

    def intersects(self, other: Rect, tolerance: float = 0.01) -> bool:
        return (
            self.x < other.x2 - tolerance
            and other.x < self.x2 - tolerance
            and self.y < other.y2 - tolerance
            and other.y < self.y2 - tolerance
        )

    def intersection_area(self, other: Rect) -> float:
        ix = max(0.0, min(self.x2, other.x2) - max(self.x, other.x))
        iy = max(0.0, min(self.y2, other.y2) - max(self.y, other.y))
        return ix * iy


def unrotated_size(profile: DeviceProfile | None) -> tuple[float, float, bool]:
    """(width, depth, is_placeholder) in the device's own frame."""
    if profile is None:
        return PLACEHOLDER_W_MM, PLACEHOLDER_D_MM, True
    w = profile.footprint.width.value_mm
    d = profile.footprint.depth.value_mm
    if w is None or d is None:
        return PLACEHOLDER_W_MM, PLACEHOLDER_D_MM, True
    return float(w), float(d), False


def rotated_size(profile: DeviceProfile | None, rotation: int) -> tuple[float, float, bool]:
    w, d, placeholder = unrotated_size(profile)
    if rotation in (90, 270):
        return d, w, placeholder
    return w, d, placeholder


def instance_rect(inst: DeviceInstance, profile: DeviceProfile | None) -> Rect:
    w, h, _ = rotated_size(profile, inst.rotation)
    return Rect(inst.x_mm, inst.y_mm, w, h)


def effective_ports(inst: DeviceInstance, profile: DeviceProfile | None) -> list[PortDef]:
    """Profile ports with instance overrides applied (override by id, add new, hide removed)."""
    base: list[PortDef] = list(profile.ports) if profile else []
    overrides = {p.id: p for p in inst.port_overrides}
    out: list[PortDef] = []
    seen: set[str] = set()
    for p in base:
        if p.id in inst.removed_port_ids:
            continue
        out.append(overrides.get(p.id, p))
        seen.add(p.id)
    for p in inst.port_overrides:
        if p.id not in seen and p.id not in inst.removed_port_ids:
            out.append(p)
            seen.add(p.id)
    return out


def _local_port_point(port: PortDef, w: float, d: float, index: int, count_on_edge: int) -> tuple[float, float, bool]:
    """Port point in the unrotated device frame. Returns (x, y, estimated)."""
    t = port.position
    estimated = t is None or port.position_evidence in (Evidence.UNKNOWN, Evidence.APPROXIMATE)
    if t is None:
        # Spread unknown ports evenly so they are visible but clearly not authoritative.
        t = (index + 1) / (count_on_edge + 1)
    if port.edge == Edge.TOP:
        return t * w, 0.0, estimated
    if port.edge == Edge.BOTTOM:
        return t * w, d, estimated
    if port.edge == Edge.LEFT:
        return 0.0, t * d, estimated
    if port.edge == Edge.RIGHT:
        return w, t * d, estimated
    # TOP_FACE: somewhere on the top panel; use t along x at mid-depth.
    return t * w, d / 2.0, estimated


def rotate_point(x: float, y: float, w: float, d: float, rotation: int) -> tuple[float, float]:
    """Rotate a point in an unrotated w x d box clockwise around the box, returning coords
    inside the rotated bounding box (top-left origin)."""
    if rotation == 0:
        return x, y
    if rotation == 90:
        return d - y, x
    if rotation == 180:
        return w - x, d - y
    if rotation == 270:
        return y, w - x
    raise ValueError(f"unsupported rotation {rotation}")


def rotate_edge(edge: Edge, rotation: int) -> Edge:
    if edge == Edge.TOP_FACE:
        return edge
    order = [Edge.TOP, Edge.RIGHT, Edge.BOTTOM, Edge.LEFT]
    steps = (rotation // 90) % 4
    return order[(order.index(edge) + steps) % 4]


@dataclass
class PlacedPort:
    instance_id: str
    port: PortDef
    x_mm: float  # absolute board coordinates
    y_mm: float
    edge: Edge  # edge after rotation
    estimated: bool


def placed_ports(inst: DeviceInstance, profile: DeviceProfile | None) -> list[PlacedPort]:
    w, d, _ = unrotated_size(profile)
    ports = effective_ports(inst, profile)
    per_edge: dict[Edge, list[PortDef]] = {}
    for p in ports:
        per_edge.setdefault(p.edge, []).append(p)
    out: list[PlacedPort] = []
    for edge, group in per_edge.items():
        unknown_idx = 0
        n_unknown = sum(1 for p in group if p.position is None)
        for p in group:
            idx = unknown_idx if p.position is None else 0
            if p.position is None:
                unknown_idx += 1
            lx, ly, est = _local_port_point(p, w, d, idx, n_unknown)
            rx, ry = rotate_point(lx, ly, w, d, inst.rotation)
            out.append(
                PlacedPort(
                    instance_id=inst.id,
                    port=p,
                    x_mm=inst.x_mm + rx,
                    y_mm=inst.y_mm + ry,
                    edge=rotate_edge(edge, inst.rotation),
                    estimated=est,
                )
            )
    return out


def underside_clearance(board: Board, spec: PedalboardSpec | None) -> tuple[float | None, str]:
    """Usable height under the board and where the figure comes from: the user's own statement
    wins, then the catalog's documented value; otherwise unknown."""
    if board.underside_clearance_mm is not None:
        return board.underside_clearance_mm, "user"
    if spec is not None and spec.underside_clearance.value_mm is not None:
        return spec.underside_clearance.value_mm, spec.underside_clearance.evidence.value
    return None, "unknown"


def board_diagnostics(
    rig: Rig, profiles: dict[str, DeviceProfile], spec: PedalboardSpec | None = None
) -> list[Diagnostic]:
    """Out-of-bounds, collisions (vs intentional overlaps), unknown footprints, and whether what
    hangs under the board can actually fit there.

    Top and underside share one coordinate system and one perimeter; they are checked for
    bounds alike and for collisions only against devices on the same surface. A footprint inside
    the perimeter is never taken as proof that a device fits underneath: that needs the device's
    height and the board's usable clearance, and both must be known."""
    diags: list[Diagnostic] = []
    board: Board = rig.board
    rects: list[tuple[DeviceInstance, Rect, bool]] = []
    clearance, clearance_src = underside_clearance(board, spec)
    underside_seen = False
    for inst in rig.instances:
        profile = profiles.get(inst.profile_id)
        if profile is None:
            diags.append(
                Diagnostic(
                    code="instance.profile_missing",
                    severity=Severity.ERROR,
                    message=f"'{inst.label}' references unknown device profile '{inst.profile_id}'.",
                    subject_type="instance",
                    subject_id=inst.id,
                )
            )
        rect = instance_rect(inst, profile)
        _, _, placeholder = unrotated_size(profile)
        if placeholder:
            diags.append(
                Diagnostic(
                    code="instance.footprint_unknown",
                    severity=Severity.WARNING,
                    message=(
                        f"'{inst.label}' has no verified footprint; a {PLACEHOLDER_W_MM:.0f} x "
                        f"{PLACEHOLDER_D_MM:.0f} mm placeholder is drawn. Enter real dimensions on the profile."
                    ),
                    subject_type="instance",
                    subject_id=inst.id,
                )
            )
        surface = inst.mount
        if surface == "off_board":
            rects.append((inst, rect, placeholder))
            continue
        where = "under" if surface == "underside" else "on"
        if rect.x < -0.01 or rect.y < -0.01 or rect.x2 > board.width_mm + 0.01 or rect.y2 > board.depth_mm + 0.01:
            diags.append(
                Diagnostic(
                    code="instance.out_of_bounds",
                    severity=Severity.ERROR,
                    message=(
                        f"'{inst.label}' extends outside the {board.width_mm:.0f} x {board.depth_mm:.0f} mm board "
                        f"({where} it; occupies x {rect.x:.0f}-{rect.x2:.0f}, y {rect.y:.0f}-{rect.y2:.0f})."
                    ),
                    subject_type="instance",
                    subject_id=inst.id,
                )
            )
        if surface == "underside":
            underside_seen = True
            diags.extend(_underside_fit(inst, profile, spec, clearance, clearance_src))
        rects.append((inst, rect, placeholder))
    for i in range(len(rects)):
        for j in range(i + 1, len(rects)):
            a, ra, _ = rects[i]
            b, rb, _ = rects[j]
            if a.mount == "off_board" or b.mount == "off_board" or a.mount != b.mount:
                continue
            if ra.intersects(rb):
                area = ra.intersection_area(rb)
                intentional = a.intentional_overlap or b.intentional_overlap
                side = " under the board" if a.mount == "underside" else ""
                diags.append(
                    Diagnostic(
                        code="instance.overlap_intentional" if intentional else "instance.collision",
                        severity=Severity.INFO if intentional else Severity.ERROR,
                        message=(
                            f"'{a.label}' and '{b.label}' overlap by {area:.0f} mm²{side}"
                            + (
                                " (marked intentional)."
                                if intentional
                                else ". Move one, or mark the overlap intentional."
                            )
                        ),
                        subject_type="instance",
                        subject_id=a.id,
                        related_ids=[b.id],
                    )
                )
    if underside_seen and spec is not None and spec.rails and spec.rail_pitch.value_mm is None:
        diags.append(
            Diagnostic(
                code="board.underside_mounting_unverified",
                severity=Severity.INFO,
                message=(
                    f"{spec.display_name} has {spec.rails} rails but their spacing is not published, so bracket fit "
                    "and the gap a device must span are not checked. Verify against the board itself."
                ),
                subject_type="rig",
            )
        )
    return diags


def _underside_fit(
    inst: DeviceInstance,
    profile: DeviceProfile | None,
    spec: PedalboardSpec | None,
    clearance: float | None,
    clearance_src: str,
) -> list[Diagnostic]:
    """Can this device hang under the board? Needs its height and the board's usable clearance."""
    out: list[Diagnostic] = []
    if spec is not None and spec.underside_mountable is False:
        out.append(
            Diagnostic(
                code="instance.underside_unavailable",
                severity=Severity.ERROR,
                message=f"'{inst.label}' is mounted under the board, but {spec.display_name} has no room underneath.",
                subject_type="instance",
                subject_id=inst.id,
            )
        )
        return out
    height = profile.footprint.height.value_mm if profile else None
    if height is None:
        out.append(
            Diagnostic(
                code="instance.underside_height_unknown",
                severity=Severity.WARNING,
                message=(
                    f"'{inst.label}' has no documented height, so whether it fits under the board is unverified. "
                    "A footprint inside the perimeter is not enough."
                ),
                subject_type="instance",
                subject_id=inst.id,
            )
        )
    if clearance is None:
        out.append(
            Diagnostic(
                code="instance.underside_clearance_unverified",
                severity=Severity.WARNING,
                message=(
                    f"The usable height under this board is not known, so '{inst.label}'"
                    + (f" ({height:g} mm tall)" if height is not None else "")
                    + " is unverified underneath. Measure it (or enter the board's clearance) before mounting."
                ),
                subject_type="instance",
                subject_id=inst.id,
            )
        )
    elif height is not None:
        src = {"user": "your measurement", "documented": "the manufacturer's figure"}.get(clearance_src, clearance_src)
        if height > clearance + 0.01:
            out.append(
                Diagnostic(
                    code="instance.underside_too_tall",
                    severity=Severity.ERROR,
                    message=(
                        f"'{inst.label}' is {height:g} mm tall but only {clearance:g} mm is available under the board "
                        f"({src}). It will not fit underneath."
                    ),
                    subject_type="instance",
                    subject_id=inst.id,
                )
            )
        else:
            out.append(
                Diagnostic(
                    code="instance.underside_fits",
                    severity=Severity.INFO,
                    message=(
                        f"'{inst.label}' ({height:g} mm tall) clears the {clearance:g} mm under the board ({src}) by "
                        f"{clearance - height:g} mm. Cable plugs and brackets still need their own room."
                    ),
                    subject_type="instance",
                    subject_id=inst.id,
                )
            )
    return out
