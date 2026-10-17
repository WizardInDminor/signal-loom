"""Hand-authored pedalboard specs with explicit provenance.

Vendor sites were unreachable from the build sandbox, so every figure below comes from retailer
listings that reproduce the manufacturer's copy (recorded as *third_party*) and is cross-checked
across several listings. Rail spacing and the usable height under the rails are not published in
any of them and are left unknown on purpose: the app must say "unverified" rather than draw a
rail or approve a supply that may not fit.
"""

from __future__ import annotations

from ..models.board import PedalboardSpec
from ..models.common import Evidence
from ..models.profile import Measure, Provenance

IN_TO_MM = 25.4


def _m(value_mm: float | None, ev: Evidence, note: str | None = None) -> Measure:
    return Measure(value_mm=None if value_mm is None else round(value_mm, 1), evidence=ev, note=note)


_PT_UNKNOWNS = [
    "rail spacing (not published)",
    "usable height under the rails (not published; brackets and rail cross-section decide it)",
    "bracket hole pattern",
]
_ZUMA_KIT = (
    "Strymon Zuma Mounting Kit lists this board as compatible (retailer compatibility lists; "
    "the kit is not for the Zuma R300)"
)


def pedaltrain_classic_2() -> PedalboardSpec:
    return PedalboardSpec(
        id="pedaltrain-classic-2",
        manufacturer="Pedaltrain",
        model="Classic 2",
        width=_m(24 * IN_TO_MM, Evidence.THIRD_PARTY, "24 in (retailer listings of the Pedaltrain spec)"),
        depth=_m(12.5 * IN_TO_MM, Evidence.THIRD_PARTY, "12.5 in"),
        height=_m(3.5 * IN_TO_MM, Evidence.THIRD_PARTY, "3.5 in overall, including the frame's elevation"),
        rails=4,
        rail_pitch=_m(None, Evidence.UNKNOWN, "four rails in the traditional Classic layout; spacing not published"),
        underside_mountable=True,
        underside_clearance=_m(
            None,
            Evidence.UNKNOWN,
            "Pedaltrain says the elevation was raised about 1 in over the PT-2 to clear more supplies; "
            "the resulting usable height is not published",
        ),
        open_front=True,
        mounting_notes="Open front for reaching a supply mounted under the rails; supplies hang from brackets or hook-and-loop.",
        compatible_brackets=[_ZUMA_KIT],
        provenance=Provenance(
            source="hand_authored",
            url="https://pedaltrain.com/products/pt-cl2-sc",
            evidence=Evidence.THIRD_PARTY,
            retrieved="2026-10-16 (retailer listings; pedaltrain.com unreachable from build sandbox)",
            attribution="Dimensions as listed by several retailers reproducing Pedaltrain's copy",
        ),
        declared_unknowns=_PT_UNKNOWNS,
        tags=["pedaltrain", "classic"],
    )


def pedaltrain_novo_24() -> PedalboardSpec:
    return PedalboardSpec(
        id="pedaltrain-novo-24",
        manufacturer="Pedaltrain",
        model="Novo 24",
        width=_m(24 * IN_TO_MM, Evidence.THIRD_PARTY, "24 in (retailer listings of the Pedaltrain spec)"),
        depth=_m(14.5 * IN_TO_MM, Evidence.THIRD_PARTY, "14.5 in"),
        height=_m(3.5 * IN_TO_MM, Evidence.THIRD_PARTY, "3.5 in overall"),
        rails=5,
        rail_pitch=_m(None, Evidence.UNKNOWN, "five rails; spacing not published"),
        underside_mountable=True,
        underside_clearance=_m(
            None, Evidence.UNKNOWN, "'elevated height for supplies and switchers' per listings; no figure"
        ),
        open_front=True,
        mounting_notes="Five-rail layout aimed at switchers; open front; hook-and-loop and zip ties included.",
        compatible_brackets=[_ZUMA_KIT],
        provenance=Provenance(
            source="hand_authored",
            url="https://pedaltrain.com/products/pt-n24-tc",
            evidence=Evidence.THIRD_PARTY,
            retrieved="2026-10-16 (retailer listings; pedaltrain.com unreachable from build sandbox)",
            attribution="Dimensions as listed by several retailers reproducing Pedaltrain's copy",
        ),
        declared_unknowns=_PT_UNKNOWNS,
        tags=["pedaltrain", "novo"],
    )


def generic_flat_board() -> PedalboardSpec:
    """A plain board or plank with nothing underneath: the honest default for an unknown make."""
    return PedalboardSpec(
        id="generic-flat-board",
        manufacturer="Generic",
        model="Flat board (no underside mounting)",
        width=_m(None, Evidence.USER, "use the rig's own width"),
        depth=_m(None, Evidence.USER, "use the rig's own depth"),
        height=_m(None, Evidence.UNKNOWN),
        rails=None,
        underside_mountable=False,
        mounting_notes="A flat board has no room under it; everything mounts on top or stays off the board.",
        provenance=Provenance(source="hand_authored", evidence=Evidence.USER),
        tags=["generic"],
    )


def builtin_boards() -> list[PedalboardSpec]:
    return [pedaltrain_classic_2(), pedaltrain_novo_24(), generic_flat_board()]


def board_spec(model_id: str | None) -> PedalboardSpec | None:
    if not model_id:
        return None
    for b in builtin_boards():
        if b.id == model_id:
            return b
    return None
