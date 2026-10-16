from app.domain.geometry import board_diagnostics, instance_rect, placed_ports, rotated_size
from app.models.rig import DeviceInstance, Rig


def test_footprint_is_proportional_to_documented_dimensions(profiles):
    w, h, placeholder = rotated_size(profiles["morningstar-mc8"], 0)
    assert (w, h, placeholder) == (224.0, 125.0, False)
    w2, h2, _ = rotated_size(profiles["morningstar-ml10x"], 0)
    assert (w2, h2) == (169.0, 58.0)
    assert w / w2 == 224 / 169


def test_rotation_swaps_bounding_box_and_moves_ports(profiles):
    inst = DeviceInstance(id="i", profile_id="morningstar-ml10x", label="ML", x_mm=100, y_mm=50, rotation=0)
    r0 = instance_rect(inst, profiles["morningstar-ml10x"])
    p0 = {p.port.id: p for p in placed_ports(inst, profiles["morningstar-ml10x"])}
    inst.rotation = 90
    r90 = instance_rect(inst, profiles["morningstar-ml10x"])
    p90 = {p.port.id: p for p in placed_ports(inst, profiles["morningstar-ml10x"])}
    assert (r0.w, r0.h) == (169.0, 58.0)
    assert (r90.w, r90.h) == (58.0, 169.0)
    # Input tip sits on the top edge at 4% across when unrotated; after 90° cw it is on the right edge.
    assert p0["in_tip"].edge.value == "top"
    assert abs(p0["in_tip"].y_mm - 50) < 1e-6
    assert p90["in_tip"].edge.value == "right"
    assert abs(p90["in_tip"].x_mm - (100 + 58)) < 1e-6
    assert abs(p90["in_tip"].y_mm - (50 + 0.04 * 169)) < 1e-6
    inst.rotation = 180
    p180 = {p.port.id: p for p in placed_ports(inst, profiles["morningstar-ml10x"])}
    assert p180["in_tip"].edge.value == "bottom"
    assert abs(p180["in_tip"].x_mm - (100 + 169 - 0.04 * 169)) < 1e-6


def test_out_of_bounds_and_collision_feedback(profiles):
    rig = Rig(name="t")
    rig.board.width_mm, rig.board.depth_mm = 300, 200
    rig.instances = [
        DeviceInstance(
            id="a", profile_id="morningstar-mc8", label="MC8", x_mm=150, y_mm=120
        ),  # 224 wide -> overflows 300
        DeviceInstance(id="b", profile_id="eqd-plumes", label="P1", x_mm=10, y_mm=10),
        DeviceInstance(id="c", profile_id="eqd-plumes", label="P2", x_mm=40, y_mm=20),  # overlaps P1
    ]
    codes = {(d.code, d.subject_id) for d in board_diagnostics(rig, profiles)}
    assert ("instance.out_of_bounds", "a") in codes
    assert ("instance.collision", "b") in codes
    rig.instances[2].intentional_overlap = True
    diags = board_diagnostics(rig, profiles)
    assert any(d.code == "instance.overlap_intentional" and d.severity.value == "info" for d in diags)
    assert not any(d.code == "instance.collision" for d in diags)


def test_unknown_footprint_uses_flagged_placeholder(profiles):
    rig = Rig(name="t", instances=[DeviceInstance(id="x", profile_id="generic-mono-effect", label="G")])
    p = profiles["generic-mono-effect"].model_copy(deep=True)
    p.footprint.width.value_mm = None
    diags = board_diagnostics(rig, {"generic-mono-effect": p})
    assert any(d.code == "instance.footprint_unknown" for d in diags)
    w, h, placeholder = rotated_size(p, 0)
    assert placeholder and w > 0 and h > 0


def test_unknown_port_positions_are_estimates_not_facts(profiles):
    inst = DeviceInstance(id="p", profile_id="eqd-plumes", label="Plumes")
    placed = placed_ports(inst, profiles["eqd-plumes"])
    assert placed and all(pp.estimated for pp in placed)
    assert "port.in.position" in profiles["eqd-plumes"].unknowns()


def test_instance_port_override_adds_custom_jack(profiles):
    from app.models.common import Edge, Evidence, PortDirection, SignalKind
    from app.models.profile import PortDef

    inst = DeviceInstance(
        id="p",
        profile_id="eqd-plumes",
        label="Plumes",
        port_overrides=[
            PortDef(
                id="exp",
                label="Custom EXP",
                kind=SignalKind.EXPRESSION,
                direction=PortDirection.IN,
                edge=Edge.TOP,
                position=0.2,
                position_evidence=Evidence.USER,
            )
        ],
    )
    placed = {pp.port.id: pp for pp in placed_ports(inst, profiles["eqd-plumes"])}
    assert "exp" in placed and not placed["exp"].estimated
    inst.removed_port_ids = ["dc_in"]
    assert "dc_in" not in {pp.port.id for pp in placed_ports(inst, profiles["eqd-plumes"])}
