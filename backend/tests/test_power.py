"""Session 3e, phase B: multi-output supplies, outlet settings, the power plan and electrical checks.

Assignments are the existing typed power cables; the plan is derived from them. Capacities of
separate outlets are never pooled; current figures are documented ratings and documented
minimums, never measurements, and the messages say so.
"""

from __future__ import annotations

import json

from app.analysis import analyze
from app.catalog.builtin import builtin_profiles
from app.domain.power import effective_outlet, voltage_accepted
from app.domain.wiring import wiring_diagnostics
from app.models.common import Severity, SignalKind
from app.models.rig import Connection, DeviceInstance, PortRef, Rig


def conn(src, sp, dst, dp, **kw):
    return Connection(
        kind=SignalKind.POWER,
        source=PortRef(instance_id=src, port_id=sp),
        target=PortRef(instance_id=dst, port_id=dp),
        **kw,
    )


def codes(diags):
    return {d.code for d in diags}


def by_code(diags, code):
    return [d for d in diags if d.code == code]


def test_zuma_profiles_match_the_manufacturer_figures(profiles):
    z = profiles["strymon-zuma"]
    outs = [p for p in z.ports if p.role == "supply_out"]
    assert len(outs) == 9 and z.category.value == "power_supply"
    fixed = [p for p in outs if not p.supply_options]
    sel = [p for p in outs if p.supply_options]
    assert len(fixed) == 7 and all(p.supply_voltage_v == 9 and p.supply_current_ma_max == 500 for p in fixed)
    assert [p.id for p in sel] == ["out8", "out9"]
    assert [(o.voltage_v, o.current_ma_max) for o in sel[0].supply_options] == [(9, 500), (12, 375), (18, 250)]
    assert all(
        p.supply_isolated is True and p.supply_ac_dc == "dc" and p.supply_polarity.value == "center_negative"
        for p in outs
    )
    # The 24 V jack is an expansion link, never counted as a pedal outlet.
    link = z.port("link24")
    assert link.role == "expansion_out" and link.supply_voltage_v == 24 and link.supply_current_ma_max is None
    assert z.footprint.width.value_mm == 173 and z.footprint.height.value_mm == 46
    assert z.provenance.evidence.value == "third_party"  # retailer-reproduced copy, not the vendor site
    r = profiles["strymon-zuma-r300"]
    r_outs = [p for p in r.ports if p.role == "supply_out"]
    assert (
        len(r_outs) == 5
        and sum(1 for p in r_outs if p.supply_options) == 1
        and r.port("link24").role == "expansion_out"
    )
    assert r.footprint.height.value_mm == 30 and r.id != z.id
    # The ML10X documents a range and a minimum current.
    ml = profiles["morningstar-ml10x"].power
    assert (ml.voltage_v, ml.voltage_max_v, ml.current_ma_min, ml.polarity.value) == (9, 18, 160, "center_negative")
    assert voltage_accepted(ml, 12) and voltage_accepted(ml, 18) and not voltage_accepted(ml, 24)


def test_selectable_outlet_capacity_follows_the_rig_setting(profiles):
    z = profiles["strymon-zuma"]
    inst = DeviceInstance(id="z", profile_id="strymon-zuma", label="Zuma", supply_settings={"out8": 18, "out9": 7})
    o8 = effective_outlet(z.port("out8"), inst)
    assert (o8.voltage_v, o8.current_ma_max, o8.selectable, o8.setting_valid) == (18, 250, True, True)
    o9 = effective_outlet(z.port("out9"), inst)  # 7 V is not a setting: invalid, default kept, no invented capacity
    assert (o9.voltage_v, o9.current_ma_max, o9.setting_valid) == (9, 500, False)
    o1 = effective_outlet(z.port("out1"), inst)
    assert (o1.voltage_v, o1.current_ma_max, o1.selectable, o1.selected_voltage_v) == (9, 500, False, None)


def _rig(settings=None, connections=(), extra=()):
    return Rig(
        name="p",
        instances=[
            DeviceInstance(
                id="z", profile_id="strymon-zuma", label="Zuma", surface="underside", supply_settings=settings or {}
            ),
            DeviceInstance(
                id="ml", profile_id="morningstar-ml10x", label="ML10X", surface="underside"
            ),  # 9-18 V, 160 mA
            DeviceInstance(id="bs", profile_id="strymon-bigsky-mx", label="BigSky", x_mm=200),  # 9 V, 500 mA
            DeviceInstance(id="pl", profile_id="eqd-plumes", label="Plumes", x_mm=300),  # 9 V, 25 mA
            DeviceInstance(id="my", profile_id="generic-mono-effect", label="Mystery", x_mm=400),  # requirement unknown
            *extra,
        ],
        connections=list(connections),
    )


def test_voltage_range_current_and_expansion_rules(profiles):
    # Out 8 set to 18 V (250 mA): fine for the ML10X (9-18 V, 160 mA); wrong for the BigSky (9 V only).
    rig = _rig(
        settings={"out8": 18, "out9": 12},
        connections=[
            conn("z", "out8", "ml", "dc_in"),
            conn("z", "out9", "bs", "dc_in"),  # 12 V into a 9 V pedal -> voltage mismatch
            conn("z", "out1", "my", "dc_in"),  # requirement unknown -> warning, never approval
            conn("z", "link24", "pl", "dc_in"),  # the Ojai link is not a pedal outlet
        ],
    )
    _, diags = wiring_diagnostics(rig, profiles)
    c = codes(diags)
    assert "power.voltage_mismatch" in c and "requires 9 V" in by_code(diags, "power.voltage_mismatch")[0].message
    assert not any(
        d.related_ids == ["ml"] for d in by_code(diags, "power.voltage_mismatch")
    )  # the ML10X at 18 V is fine
    assert "power.requirement_unknown" in c  # voltage unknown: nothing further is claimed about current
    assert "power.expansion_outlet" in c and by_code(diags, "power.expansion_outlet")[0].severity == Severity.ERROR
    # A (test-only) pedal that accepts 9-18 V but documents a 500 mA minimum: on out 8 at 12 V the
    # voltage is fine and the 375 mA rating is short; at 9 V the same outlet is rated 500 mA and is accepted.
    wide = profiles["strymon-bigsky-mx"].model_copy(deep=True)
    wide.id = "test-wide"
    wide.power.voltage_max_v = 18
    profiles = {**profiles, "test-wide": wide}
    extra = [DeviceInstance(id="wd", profile_id="test-wide", label="Wide", x_mm=500)]
    rig = _rig(settings={"out8": 12}, connections=[conn("z", "out8", "wd", "dc_in")], extra=extra)
    _, diags = wiring_diagnostics(rig, profiles)
    short = by_code(diags, "power.current_insufficient")
    assert len(short) == 1 and short[0].severity == Severity.ERROR
    assert "375 mA at 12 V" in short[0].message and "documents a 500 mA minimum requirement" in short[0].message
    assert "power.voltage_mismatch" not in codes(diags)
    rig = _rig(settings={}, connections=[conn("z", "out8", "wd", "dc_in")], extra=extra)
    _, diags = wiring_diagnostics(rig, profiles)
    assert not any(d.code.startswith("power.") and d.subject_type == "connection" for d in diags)
    # An impossible setting is an error and the default (not an invented capacity) is used.
    rig = _rig(settings={"out8": 7}, connections=[conn("z", "out8", "pl", "dc_in")])
    _, diags = wiring_diagnostics(rig, profiles)
    assert "power.invalid_setting" in codes(diags)


def test_polarity_and_ac_dc_mismatches_are_errors(profiles):
    pos = DeviceInstance(id="cp", profile_id="generic-isolated-psu", label="Odd supply", surface="off_board")
    pos.port_overrides = [
        profiles["generic-isolated-psu"].port("out1").model_copy(update={"supply_polarity": "center_positive"}),
        profiles["generic-isolated-psu"]
        .port("out2")
        .model_copy(update={"supply_ac_dc": "ac", "supply_polarity": None}),
    ]
    rig = _rig(connections=[conn("cp", "out1", "pl", "dc_in"), conn("cp", "out2", "bs", "dc_in")], extra=[pos])
    _, diags = wiring_diagnostics(rig, profiles)
    pol = by_code(diags, "power.polarity_mismatch")
    assert len(pol) == 1 and pol[0].severity == Severity.ERROR and "center positive" in pol[0].message
    acdc = by_code(diags, "power.ac_dc_mismatch")
    assert len(acdc) == 1 and acdc[0].severity == Severity.ERROR and "AC" in acdc[0].message
    # An AC outlet gets no polarity check (polarity is a DC notion).
    assert not any(d.related_ids == ["bs"] for d in by_code(diags, "power.polarity_mismatch"))


def test_shared_outlet_aggregates_documented_minimums_without_pooling_outlets(profiles):
    # BigSky (500) + ML10X (160) on one 500 mA outlet: overloaded, even though the Zuma has 4 A spare elsewhere.
    rig = _rig(
        connections=[
            conn("z", "out1", "bs", "dc_in"),
            conn("z", "out1", "ml", "dc_in"),
            conn("z", "out2", "pl", "dc_in"),
        ]
    )
    _, diags = wiring_diagnostics(rig, profiles)
    over = by_code(diags, "power.outlet_overloaded")
    assert len(over) == 1 and over[0].severity == Severity.ERROR
    assert "adding up to 660 mA" in over[0].message and "Documented minimums, not measured draw" in over[0].message
    assert "power.outlet_shared_assumption" in codes(diags) and "connection.power_daisy_chain" in codes(diags)
    # Plumes alone on out 2 is fine: nothing about out 2 in the diagnostics.
    assert not any(d.subject_id == rig.connections[2].id for d in diags if d.code.startswith("power."))
    # An undocumented device on a shared outlet makes the total unknowable (warning), not an approval.
    rig = _rig(connections=[conn("z", "out1", "pl", "dc_in"), conn("z", "out1", "my", "dc_in")])
    _, diags = wiring_diagnostics(rig, profiles)
    assert "power.outlet_load_unknown" in codes(diags) and "power.outlet_overloaded" not in codes(diags)


def test_power_plan_reports_outlets_loads_remaining_and_gaps(profiles):
    rig = _rig(
        settings={"out8": 12},
        connections=[
            conn("z", "out1", "bs", "dc_in"),
            conn("z", "out1", "ml", "dc_in"),
            conn("z", "out8", "pl", "dc_in"),
            conn("z", "out2", "my", "dc_in"),
        ],
    )
    a = analyze(rig, profiles)
    plan = a["power"]
    assert "not measured draw" in plan["note"]
    assert [s["instance_id"] for s in plan["supplies"]] == ["z"] and plan["supplies"][0]["surface"] == "underside"
    outs = {o["port_id"]: o for o in plan["supplies"][0]["outputs"]}
    assert len(outs) == 10 and outs["link24"]["status"] == "expansion" and outs["link24"]["expansion"] is True
    o1 = outs["out1"]
    assert o1["status"] == "error" and o1["required_known_ma"] == 660 and o1["remaining_ma"] == -160
    assert {a_["instance_id"] for a_ in o1["assigned"]} == {"bs", "ml"} and "power.outlet_overloaded" in o1["issues"]
    o8 = outs["out8"]
    assert (o8["voltage_v"], o8["current_ma_max"], o8["selected_voltage_v"], o8["setting_valid"]) == (12, 375, 12, True)
    assert o8["options"] == [
        {"voltage_v": 9, "current_ma_max": 500},
        {"voltage_v": 12, "current_ma_max": 375},
        {"voltage_v": 18, "current_ma_max": 250},
    ]
    assert (
        o8["status"] == "error" and o8["remaining_ma"] == 350
    )  # Plumes needs 9 V: mismatch at 12 V, arithmetic still shown
    assert "power.voltage_mismatch" in o8["issues"]
    o2 = outs["out2"]
    assert o2["status"] == "unknown" and o2["unknown_count"] == 1 and o2["remaining_ma"] is None
    assert outs["out3"]["status"] == "unused" and outs["out3"]["remaining_ma"] == 500
    # Nothing is pooled: no total appears on the supply, only per outlet.
    assert "remaining_ma" not in plan["supplies"][0]
    consumers = {c["instance_id"]: c for c in plan["consumers"]}
    assert consumers["ml"]["voltage_max_v"] == 18 and consumers["my"]["requirement_known"] is False
    assert set(plan["unknown_requirements"]) == {"my"} and plan["unpowered"] == []
    # Unplug the ML10X: it appears as unpowered, and the overload disappears.
    rig.connections = [c for c in rig.connections if c.target.instance_id != "ml"]
    plan = analyze(rig, profiles)["power"]
    assert plan["unpowered"] == ["ml"]
    assert {o["port_id"]: o["status"] for o in plan["supplies"][0]["outputs"]}["out1"] == "ok"


def test_settings_survive_save_export_import_and_reach_the_plan(client):
    rig = client.post("/api/rigs", json={"name": "Power round trip"}).json()
    rig["instances"] = [
        {
            "id": "z",
            "profile_id": "strymon-zuma",
            "label": "Zuma",
            "x_mm": 20,
            "y_mm": 150,
            "rotation": 0,
            "intentional_overlap": False,
            "off_board": False,
            "surface": "underside",
            "midi_channel": None,
            "port_overrides": [],
            "removed_port_ids": [],
            "supply_settings": {"out8": 18},
        },
        {
            "id": "ml",
            "profile_id": "morningstar-ml10x",
            "label": "ML10X",
            "x_mm": 300,
            "y_mm": 150,
            "rotation": 0,
            "intentional_overlap": False,
            "off_board": False,
            "surface": "underside",
            "midi_channel": None,
            "port_overrides": [],
            "removed_port_ids": [],
        },
    ]
    rig["connections"] = [
        {
            "id": "c1",
            "kind": "power",
            "source": {"instance_id": "z", "port_id": "out8"},
            "target": {"instance_id": "ml", "port_id": "dc_in"},
            "intentional": False,
        }
    ]
    rig["revision"] += 1
    assert client.put(f"/api/rigs/{rig['id']}", json=rig).status_code == 200
    a = client.get(f"/api/rigs/{rig['id']}/analysis").json()
    o8 = next(o for o in a["power"]["supplies"][0]["outputs"] if o["port_id"] == "out8")
    assert (o8["voltage_v"], o8["current_ma_max"], o8["status"], o8["remaining_ma"]) == (18, 250, "ok", 90)
    exported = client.get(f"/api/rigs/{rig['id']}/export").json()
    imp = client.post("/api/rigs/import", content=json.dumps(exported)).json()["rig"]
    assert imp["instances"][0]["supply_settings"] == {"out8": 18}
    # A profile without the new fields (an older custom supply) still validates.
    old = next(p for p in builtin_profiles() if p.id == "generic-isolated-psu").model_dump(mode="json")
    for port in old["ports"]:
        for k in ("supply_ac_dc", "supply_options", "supply_isolated", "supply_shared_group"):
            port.pop(k, None)
    old["id"] = "legacy-psu"
    old["builtin"] = False
    assert client.post("/api/catalog/devices", json=old).status_code == 201
