"""Session 4 route graph: coverage per device × message kind, evidence, prerequisites, per-network
channel collisions, suggestions for unreachable devices, and capability filtering."""

from __future__ import annotations

from app.catalog.demo import demo_rig
from app.domain.wiring import wiring_diagnostics
from app.live.routes import build_route_graph
from app.live.transport import EndpointInfo
from app.models.live import ChannelGroup, EndpointBinding, LiveBindings
from app.models.rig import DeviceInstance

MC8_OUT = EndpointInfo("virt:inst_mc8:out", "Virtual USB — MC8", "out", "virtual")
ML_OUT = EndpointInfo("virt:inst_ml10x:out", "Virtual USB — ML10X", "out", "virtual")
BS_OUT = EndpointInfo("virt:inst_bigsky:out", "Virtual USB — BigSky MX", "out", "virtual")


def bind(*pairs, groups=(), verified=None):
    return LiveBindings(
        rig_id="rig_demo_signal_loom",
        bindings=[EndpointBinding(endpoint_id=e, instance_id=i, port_id=p) for e, i, p in pairs],
        channel_groups=list(groups),
        verified_hops=verified or {},
    )


def graph(rig, profiles, bindings, endpoints):
    ctx, _ = wiring_diagnostics(rig, profiles)
    return build_route_graph(rig, profiles, ctx, bindings, endpoints)


def row(g, label, kind):
    return next(r for r in g.coverage_rows() if r["label"] == label and r["kind"] == kind)


def test_single_mc8_uplink_reaches_the_chain_with_evidence_and_prerequisites(profiles):
    rig = demo_rig()
    g = graph(rig, profiles, bind(("virt:inst_mc8:out", "inst_mc8", "usb")), [MC8_OUT])
    # PC/CC to every device on the chain are published, with the MC8's Cross MIDI Thru as prerequisite.
    for label in ("ML10X", "BigSky MX", "Sunset"):
        for kind in ("pc", "cc"):
            r = row(g, label, kind)
            assert r["status"] == "supported" and r["evidence"] == "published", (label, kind, r)
            assert any("Cross MIDI Thru" in p for p in r["prerequisites"])
    # The BigSky is reached through the ML10X's hardware Thru: four hops of cable/forwarding.
    bs = row(g, "BigSky MX", "pc")
    assert bs["endpoint_name"] == "Virtual USB — MC8"
    assert "ML10X:midi_thru → BigSky MX:midi_in" in bs["hops"]
    # Sunset via the Omniport needs the Omniport in MIDI-out mode and Strymon's MIDI EXP cable.
    su = row(g, "Sunset", "cc")
    assert any("Omniport" in p for p in su["prerequisites"]) and any("MIDI EXP cable" in p for p in su["prerequisites"])
    # SysEx never crosses an Omniport (published) and is unknown through the DIN chain (never claimed).
    assert row(g, "Sunset", "sysex_read")["status"] == "unsupported"
    assert row(g, "Sunset", "sysex_read")["evidence"] == "published"
    assert row(g, "BigSky MX", "sysex_read")["status"] == "unverified"
    # Clock through the chain is unverified: the ML10X's clock handling is not documented.
    assert row(g, "ML10X", "clock")["status"] == "unverified"
    # The MC8 itself is a receiver on its own channel.
    assert row(g, "MC8", "pc")["status"] == "supported" and g.targets["inst_mc8"].channel == 16
    # One receiver network behind the MC8 USB, four members, no collision (channels 16/10/2/3).
    assert len(g.networks) == 1
    assert sorted(m["label"] for m in g.networks[0].members) == ["BigSky MX", "MC8", "ML10X", "Sunset"]
    assert g.networks[0].collisions == []


def test_unreachable_devices_get_the_smallest_evidence_based_suggestion(profiles):
    rig = demo_rig()
    g = graph(rig, profiles, LiveBindings(rig_id=rig.id), [MC8_OUT])
    r = row(g, "BigSky MX", "pc")
    assert r["status"] == "unreachable" and r["endpoint_id"] is None
    assert any("Bind a USB endpoint to 'BigSky MX: USB-C'" in s for s in r["suggestions"])
    assert any("upstream of ML10X" in s for s in r["suggestions"])  # the DIN chain already exists
    # A pedal with a MIDI input but no cable: propose a cable from the MC8's free output, carefully worded.
    rig.connections = [c for c in rig.connections if c.target.port_id != "exp_midi"]
    g2 = graph(rig, profiles, LiveBindings(rig_id=rig.id), [MC8_OUT])
    s = row(g2, "Sunset", "pc")["suggestions"]
    assert any("Omniport 1" in x and "check the pinout" in x for x in s), s
    # A bound endpoint that is not currently present is reported, not silently treated as a route.
    g3 = graph(rig, profiles, bind(("virt:inst_mc8:out", "inst_mc8", "usb")), [])
    assert any(d.code == "live.endpoint_missing" for d in g3.diagnostics)
    assert row(g3, "ML10X", "pc")["status"] == "unreachable"


def test_collisions_are_scoped_to_a_receiver_network_not_the_computer(profiles):
    rig = demo_rig()
    # Put the BigSky on the Sunset's channel 3: both hang behind the MC8 uplink → collision.
    rig.instance("inst_bigsky").midi_channel = 3
    g = graph(rig, profiles, bind(("virt:inst_mc8:out", "inst_mc8", "usb")), [MC8_OUT])
    codes = [d.code for d in g.diagnostics]
    assert codes == ["live.channel_collision"]
    assert set(g.diagnostics[0].related_ids) == {"inst_sunset", "inst_bigsky"}
    # Declared deliberate: the same fact becomes an informational note.
    g2 = graph(
        rig,
        profiles,
        bind(
            ("virt:inst_mc8:out", "inst_mc8", "usb"),
            groups=[ChannelGroup(channel=3, instance_ids=["inst_sunset", "inst_bigsky"], note="drive + verb together")],
        ),
        [MC8_OUT],
    )
    assert [d.code for d in g2.diagnostics] == ["live.channel_group"]
    assert g2.diagnostics[0].severity.value == "info"
    # Independent USB endpoints: ML10X on channel 1 and BigSky on channel 1, each on its own cable,
    # no MC8 binding → two networks, no collision.
    rig2 = demo_rig()
    rig2.connections = [c for c in rig2.connections if c.kind.value != "midi"]
    rig2.instance("inst_ml10x").midi_channel = 1
    rig2.instance("inst_bigsky").midi_channel = 1
    g3 = graph(
        rig2,
        profiles,
        bind(("virt:inst_ml10x:out", "inst_ml10x", "usb"), ("virt:inst_bigsky:out", "inst_bigsky", "usb")),
        [ML_OUT, BS_OUT],
    )
    assert len(g3.networks) == 2 and all(n.collisions == [] for n in g3.networks)
    assert not any(d.code == "live.channel_collision" for d in g3.diagnostics)
    # …but the same two pedals on one MC8 DIN bus on channel 1 would collide.
    rig3 = demo_rig()
    rig3.instance("inst_ml10x").midi_channel = 1
    rig3.instance("inst_bigsky").midi_channel = 1
    g4 = graph(rig3, profiles, bind(("virt:inst_mc8:out", "inst_mc8", "usb")), [MC8_OUT])
    assert [d.code for d in g4.diagnostics] == ["live.channel_collision"]


def test_best_route_per_kind_prefers_evidence_then_fewer_hops_and_lists_alternatives(profiles):
    rig = demo_rig()
    g = graph(
        rig,
        profiles,
        bind(("virt:inst_mc8:out", "inst_mc8", "usb"), ("virt:inst_bigsky:out", "inst_bigsky", "usb")),
        [MC8_OUT, BS_OUT],
    )
    t = g.targets["inst_bigsky"]
    assert len(t.routes) == 2
    assert t.route_for("pc").endpoint_id == "virt:inst_bigsky:out"  # direct USB: same evidence, fewer hops
    assert g.networks[0].members and len(g.networks) == 2
    # A user-recorded hardware verification raises the evidence of that route only.
    g2 = graph(
        rig,
        profiles,
        bind(
            ("virt:inst_mc8:out", "inst_mc8", "usb"),
            verified={h.key: "2026-10-20 PC 2 arrived" for h in g.targets["inst_ml10x"].routes[0].hops},
        ),
        [MC8_OUT],
    )
    assert row(g2, "ML10X", "pc")["evidence"] == "hardware_verified"
    assert row(g2, "BigSky MX", "pc")["evidence"] == "published"  # the ML10X→BigSky hops were not claimed


def test_usb_jack_without_documented_usb_midi_is_not_a_computer_endpoint(profiles):
    """Sunset's USB is firmware-only; binding it must say so instead of inventing a route."""
    rig = demo_rig()
    sunset = rig.instance("inst_sunset")
    from app.models.common import Connector, PortDirection, SignalKind
    from app.models.profile import PortDef

    sunset.port_overrides.append(
        PortDef(
            id="usb_fw",
            label="USB (firmware)",
            kind=SignalKind.USB,
            direction=PortDirection.BIDIRECTIONAL,
            connector=Connector.USB_MINI,
        )
    )
    ep = EndpointInfo("virt:generic:out", "Virtual USB MIDI interface (out)", "out", "virtual")
    g = graph(rig, profiles, bind(("virt:generic:out", "inst_sunset", "usb_fw")), [ep])
    r = row(g, "Sunset", "pc")
    assert r["status"] == "unsupported" and "firmware" in r["reason"]
    # Routes through a device the sender cannot address are filtered: the sender refuses them.
    assert g.targets["inst_sunset"].coverage("cc").status == "unsupported"


def test_forwarding_is_never_inferred_from_usb_into_a_physical_thru(profiles):
    """ML10X bound by its own USB: the ML10X itself is reachable, the BigSky behind its Thru is unverified."""
    rig = demo_rig()
    g = graph(rig, profiles, bind(("virt:inst_ml10x:out", "inst_ml10x", "usb")), [ML_OUT])
    assert row(g, "ML10X", "pc")["status"] == "supported"
    bs = row(g, "BigSky MX", "pc")
    assert bs["status"] == "unverified" and "not documented" in bs["reason"]
    # A generic device with a port marked "thru" is likewise unknown, never assumed.
    rig.instances.append(
        DeviceInstance(id="inst_x", profile_id="generic-stereo-effect", label="Mystery", midi_channel=4)
    )
    g2 = graph(rig, profiles, bind(("virt:inst_ml10x:out", "inst_ml10x", "usb")), [ML_OUT])
    assert "inst_x" not in g2.targets  # no MIDI interface, no jack: not a live target at all
