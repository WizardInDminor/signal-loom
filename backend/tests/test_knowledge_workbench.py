"""Session 6: the MIDI Knowledge Workbench — structured control knowledge on the documented CC map,
Quick Reference notes on profiles and placed units, source citations, review and hardware status,
and how all of it reaches scenes, textures, exports and imports.

Every PDF here is synthetic (``tests/support/pdf.py``); no manufacturer document is read or bundled.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.catalog.builtin import builtin_profiles
from app.catalog.demo import demo_rig
from app.documents import propose_controls
from app.domain.commands import commands_from_midi_spec
from app.domain.compiler import compile_rig
from app.domain.wiring import build_context
from app.exports.project import scrub_profile_knowledge
from app.instrument.eligibility import check_cc, check_mapping, continuous_controls
from app.main import create_app
from app.models.common import Evidence
from app.models.profile import CcDef, DeviceNote, DeviceProfile, MidiSpec, SourceCitation
from app.models.rig import CcValue, DeviceInstance
from app.models.texture import Mapping

from .support.pdf import make_pdf

MANUAL = make_pdf(
    [
        "Synthetic MIDI guide (test fixture)",
        "MIDI implementation chart. CC 12 Echo Level 0-127. CC 15 Spacing 0-127. CC 102 Bypass 0 = off, 127 = on.",
        "Saving a preset: hold FAV until it flashes, then press the footswitch of the slot.",
    ]
)
DOC = "doc_0123456789ab"


def _profile_body(pid: str) -> dict:
    return {
        "id": pid,
        "manufacturer": "Test",
        "model": "Knowledge pedal",
        "provenance": {"source": "user", "evidence": "user"},
        "midi": {"interfaces": ["din_in"], "default_channel": 1, "evidence": "user"},
    }


def _attach(client, pid: str) -> str:
    r = client.post(
        f"/api/catalog/devices/{pid}/documents",
        data={"title": "MIDI guide", "kind": "midi_chart"},
        files={"file": ("guide.pdf", MANUAL, "application/pdf")},
    )
    assert r.status_code == 201, r.text
    return r.json()["documents"][0]["document_id"]


def control(cc: int, name: str, **kw) -> dict:
    return {"cc": cc, "name": name, "evidence": "documented", **kw}


# --------------------------------------------------------------------------- model rules


def test_behavior_and_continuous_stay_in_agreement_and_legacy_entries_load():
    legacy = CcDef(cc=12, name="Echo Level", continuous=True)
    assert legacy.behavior == "continuous" and legacy.reviewed is True
    assert CcDef(cc=1, name="x", continuous=False).behavior == "discrete"
    assert CcDef(cc=1, name="x").behavior is None and CcDef(cc=1, name="x").continuous is None
    for b, cont in (
        ("continuous", True),
        ("discrete", False),
        ("toggle", False),
        ("trigger", False),
        ("unknown", None),
    ):
        assert CcDef(cc=1, name="x", behavior=b).continuous is cont
    with pytest.raises(ValidationError, match="contradicts"):
        CcDef(cc=1, name="x", behavior="toggle", continuous=True)
    # An older client that only knows the flag may flip it on a profile the API returned with a
    # derived behaviour; the flag wins because the behaviour said no more than the flag did.
    assert CcDef(cc=1, name="x", behavior="continuous", continuous=False).behavior == "discrete"
    assert CcDef(cc=1, name="x", behavior="unknown", continuous=True).behavior == "continuous"
    with pytest.raises(ValidationError, match="min_value"):
        CcDef(cc=1, name="x", min_value=100, max_value=10)
    with pytest.raises(ValidationError, match="user_configured"):
        CcDef(cc=1, name="x", factory_cc=7)
    remapped = CcDef(cc=1, name="x", mapping="user_configured", factory_cc=7)
    assert remapped.factory_cc == 7
    assert CcDef(cc=1, name="x", min_value=10, max_value=100).in_range(10) is True
    assert CcDef(cc=1, name="x", min_value=10, max_value=100).in_range(101) is False
    # The hardware claim is never derived: a documented, cited, continuous control is still unverified.
    cited = CcDef(cc=1, name="x", behavior="continuous", citation=SourceCitation(document_id=DOC, page=2))
    assert cited.hardware_status == "unverified"


def test_notes_need_unique_ids_and_keep_only_real_steps():
    n = DeviceNote(id="note_a", title="Save a preset", steps=["  hold FAV ", "", "press slot"])
    assert n.steps == ["hold FAV", "press slot"]
    with pytest.raises(ValidationError, match="unique"):
        DeviceProfile(id="p", manufacturer="m", model="x", quick_reference=[n, n])
    with pytest.raises(ValidationError, match="unique"):
        DeviceInstance(profile_id="p", label="x", quick_reference=[n, n])
    prof = DeviceProfile(
        id="p",
        manufacturer="m",
        model="x",
        midi=MidiSpec(cc_map=[CcDef(cc=1, name="a", citation=SourceCitation(document_id=DOC, page=1))]),
        quick_reference=[
            DeviceNote(id="note_b", title="t", references=[SourceCitation(document_id="doc_ba9876543210")])
        ],
    )
    assert prof.document_ids() == [DOC, "doc_ba9876543210"]


# --------------------------------------------------------------------------- API


def test_controls_and_notes_round_trip_through_the_api_and_a_restart(db_path):
    with TestClient(create_app(db_path)) as client:
        pid = "kw-pedal"
        assert client.post("/api/catalog/devices", json=_profile_body(pid)).status_code == 201
        did = _attach(client, pid)
        cc_map = [
            control(
                12,
                "Echo Level",
                behavior="continuous",
                min_value=0,
                max_value=127,
                citation={"document_id": did, "page": 2},
            ),
            control(
                15,
                "Spacing",
                behavior="continuous",
                citation={"document_id": did, "page": 2},
                hardware_status="verified",
                hardware_note="swept by hand",
            ),
            control(102, "Bypass", behavior="toggle", citation={"document_id": did, "page": 2}),
            control(
                3, "Mix (remapped)", behavior="continuous", mapping="user_configured", factory_cc=20, evidence="user"
            ),
            control(40, "Proposed thing", review_status="proposed", citation={"document_id": did, "page": 2}),
        ]
        r = client.put(f"/api/catalog/devices/{pid}/controls", json={"cc_map": cc_map})
        assert r.status_code == 200, r.text
        prof = r.json()
        by_cc = {c["cc"]: c for c in prof["midi"]["cc_map"]}
        assert by_cc[12]["continuous"] is True and by_cc[102]["continuous"] is False and by_cc[40]["continuous"] is None
        assert by_cc[15]["hardware_status"] == "verified" and by_cc[12]["hardware_status"] == "unverified"
        assert by_cc[3]["mapping"] == "user_configured" and by_cc[3]["factory_cc"] == 20
        assert by_cc[40]["review_status"] == "proposed"
        # Only the CC map changed: documents, commands and provenance are untouched.
        assert prof["documents"][0]["document_id"] == did and prof["midi"]["commands"] == []
        assert prof["source"] == "custom"
        # Duplicate CC numbers are refused with the numbers named.
        dup = client.put(f"/api/catalog/devices/{pid}/controls", json={"cc_map": [control(5, "a"), control(5, "b")]})
        assert dup.status_code == 422 and "5" in dup.text
        # A contradiction between behaviour and the legacy flag is refused, not guessed.
        bad = client.put(
            f"/api/catalog/devices/{pid}/controls",
            json={"cc_map": [control(5, "a", behavior="toggle", continuous=True)]},
        )
        assert bad.status_code == 422

        notes = [
            {
                "id": "note_save",
                "title": "Save a preset",
                "category": "presets",
                "body": "The pedal arms saving by hand; MIDI PC then picks the slot.",
                "steps": ["Hold FAV until it flashes", "Press the footswitch of the slot"],
                "references": [{"document_id": did, "page": 3}],
                "evidence": "documented",
                "pinned": True,
            },
            {
                "id": "note_ch",
                "title": "MIDI channel",
                "category": "midi_setup",
                "body": "Hold both footswitches at power-up.",
                "evidence": "user",
            },
        ]
        r = client.put(f"/api/catalog/devices/{pid}/quick-reference", json={"notes": notes})
        assert r.status_code == 200, r.text
        saved = r.json()["quick_reference"]
        assert [n["id"] for n in saved] == ["note_save", "note_ch"]
        assert saved[0]["pinned"] is True and saved[0]["created_at"] and saved[0]["updated_at"]
        created_at = saved[0]["created_at"]
        # Re-saving an unchanged note keeps its timestamps; the second note is edited.
        notes[1]["body"] = "Hold both footswitches at power-up; release when the LED blinks."
        again = client.put(f"/api/catalog/devices/{pid}/quick-reference", json={"notes": notes}).json()[
            "quick_reference"
        ]
        assert again[0]["created_at"] == created_at and again[0]["updated_at"] == saved[0]["updated_at"]
        assert again[1]["created_at"] == saved[1]["created_at"]
        assert (
            client.put(f"/api/catalog/devices/{pid}/quick-reference", json={"notes": [notes[0], notes[0]]}).status_code
            == 422
        )
        # The cited document is reported as present, and cannot be deleted while a control cites it.
        files = {f["document_id"]: f for f in client.get(f"/api/catalog/devices/{pid}").json()["document_files"]}
        assert files[did]["present"] is True
        assert client.delete(f"/api/documents/{did}").status_code == 409

    with TestClient(create_app(db_path)) as client:
        prof = client.get(f"/api/catalog/devices/{pid}").json()
        assert len(prof["midi"]["cc_map"]) == 5 and len(prof["quick_reference"]) == 2
        assert prof["quick_reference"][0]["steps"] == ["Hold FAV until it flashes", "Press the footswitch of the slot"]
        # Detaching the document keeps the citations (the page reference is knowledge too) and the
        # profile reports the file as still present on this computer.
        r = client.delete(f"/api/catalog/devices/{pid}/documents/{did}")
        assert r.status_code == 200 and r.json()["documents"] == []
        assert r.json()["midi"]["cc_map"][0]["citation"]["document_id"] == did
        assert client.get(f"/api/documents/{did}").json()["referenced_by"] == [pid]


def test_control_usage_lists_scene_values_and_texture_mappings_per_cc(client):
    rigs = client.get("/api/rigs").json()
    demo = next(r for r in rigs if r["name"].startswith("Demo rig"))
    rig = client.get(f"/api/rigs/{demo['id']}").json()
    scene = rig["scenes"][0]
    sunset_state = next(s for s in scene["device_states"] if s["instance_id"] == "inst_sunset")
    sunset_state["cc_values"].append({"cc": 100, "value": 64})
    rig["textures"] = [
        {
            "id": "tex_usage",
            "name": "Usage test",
            "tempo_bpm": 90,
            "macros": [
                {
                    "id": "mac_1",
                    "name": "Bloom",
                    "base": 0.5,
                    "lfo": {"enabled": False, "shape": "triangle", "beats_per_cycle": 4, "depth": 0},
                    "mappings": [
                        {
                            "id": "map_1",
                            "instance_id": "inst_sunset",
                            "cc": 100,
                            "output_min": 10,
                            "output_max": 90,
                            "enabled": True,
                            "user_override": False,
                        }
                    ],
                }
            ],
            "function_roles": {},
            "origin": "user",
        }
    ]
    rig["revision"] += 1
    assert client.put(f"/api/rigs/{rig['id']}", json=rig).status_code == 200, "rig save"
    report = client.get("/api/catalog/devices/strymon-sunset/control-usage").json()
    usage = report["controls"]
    assert usage["100"]["scenes"][0]["scene_name"] == scene["name"] and usage["100"]["scenes"][0]["value"] == 64
    assert (
        usage["100"]["textures"][0]["texture_name"] == "Usage test" and usage["100"]["textures"][0]["output_max"] == 90
    )
    # Bypass via the scene's state column is compiled, not stored as a CC value, so CC 10 is not a "use" here.
    assert "10" not in usage or usage["10"]["scenes"] == []
    # Every placed unit sharing the profile is listed: a profile-level claim applies to all of them.
    assert {(x["rig_name"], x["instance_label"]) for x in report["units"]} >= {(rig["name"], "Sunset")}
    assert client.get("/api/catalog/devices/nope/control-usage").status_code == 404


def test_entering_controls_never_claims_a_midi_interface(db_path):
    with TestClient(create_app(db_path)) as client:
        body = {
            "id": "kw-no-midi",
            "manufacturer": "Test",
            "model": "Silent",
            "provenance": {"source": "user", "evidence": "user"},
        }
        assert client.post("/api/catalog/devices", json=body).status_code == 201
        r = client.put(
            "/api/catalog/devices/kw-no-midi/controls", json={"cc_map": [control(12, "Level", behavior="continuous")]}
        )
        assert r.status_code == 200, r.text
        midi = r.json()["midi"]
        assert midi["interfaces"] == [] and midi["evidence"] == "unknown"  # how MIDI reaches the pedal is still unknown
        # The explicit statement is the only way to declare the input, and it is recorded as the user's.
        d = client.post(
            "/api/catalog/devices/kw-no-midi/midi-capability", json={"interfaces": ["usb"], "default_channel": 2}
        )
        assert (
            d.status_code == 200
            and d.json()["midi"]["interfaces"] == ["usb"]
            and d.json()["midi"]["evidence"] == "user"
        )
        assert len(d.json()["midi"]["cc_map"]) == 1


def test_from_documented_map_carries_the_citation_and_skips_proposed_controls():
    midi = MidiSpec(
        interfaces=["din_in"],
        cc_map=[
            CcDef(
                cc=12,
                name="Echo Level",
                behavior="continuous",
                evidence=Evidence.DOCUMENTED,
                citation=SourceCitation(document_id=DOC, page=2),
                min_value=0,
                max_value=100,
            ),
            CcDef(cc=102, name="Bypass", behavior="toggle", evidence=Evidence.DOCUMENTED, hardware_status="verified"),
            CcDef(cc=40, name="Proposed", review_status="proposed", evidence=Evidence.DOCUMENTED),
        ],
    )
    cmds = {c.cc: c for c in commands_from_midi_spec(midi)}
    assert set(cmds) == {12, 102}
    assert cmds[12].citation is not None and cmds[12].citation.page == 2 and cmds[12].evidence == Evidence.DOCUMENTED
    assert "documented range 0–100" in (cmds[12].description or "")
    assert cmds[102].intent == "toggle" and cmds[102].deterministic is False and cmds[102].verified_on_hardware is True
    assert cmds[12].verified_on_hardware is False


# --------------------------------------------------------------------------- eligibility and compiler


def test_proposed_controls_are_not_eligible_and_toggle_or_trigger_are_refused():
    profs = {p.id: p for p in builtin_profiles()}
    sunset = profs["strymon-sunset"].model_copy(deep=True)
    sunset.midi.cc_map = [
        CcDef(cc=50, name="Mix", behavior="continuous", evidence=Evidence.DOCUMENTED, review_status="proposed"),
        CcDef(cc=51, name="Tap", behavior="trigger", evidence=Evidence.DOCUMENTED),
        CcDef(cc=52, name="Mode flip", behavior="toggle", evidence=Evidence.DOCUMENTED),
        CcDef(
            cc=53,
            name="Level",
            behavior="continuous",
            evidence=Evidence.DOCUMENTED,
            min_value=0,
            max_value=100,
            review_status="reviewed",
        ),
    ]
    rig = demo_rig()
    inst = rig.instance("inst_sunset")
    e = check_cc(inst, sunset, 50)
    assert e.eligible is False and e.hard_refusal is False and "not been reviewed" in e.reason
    assert check_cc(inst, sunset, 51).hard_refusal is True
    assert check_cc(inst, sunset, 52).hard_refusal is True
    ok = check_cc(inst, sunset, 53)
    assert ok.eligible is True and ok.basis == "documented"
    # A mapping that leaves the documented range is eligible but warned about.
    m = Mapping(id="map_x", instance_id="inst_sunset", cc=53, output_min=0, output_max=127)
    w = check_mapping(rig, {**profs, "strymon-sunset": sunset}, m)
    assert w.eligible is True and any("documented range 0–100" in x for x in w.warnings)
    inside = check_mapping(
        rig,
        {**profs, "strymon-sunset": sunset},
        Mapping(id="map_y", instance_id="inst_sunset", cc=53, output_min=90, output_max=20),
    )
    assert not any("documented range" in x for x in inside.warnings)
    rows = {r["cc"]: r for r in continuous_controls(inst, sunset)}
    assert (
        rows[50]["review_status"] == "proposed" and rows[53]["max_value"] == 100 and rows[51]["behavior"] == "trigger"
    )


def test_compiler_warns_on_out_of_range_and_unreviewed_values_without_changing_bytes():
    profs = {p.id: p for p in builtin_profiles()}
    sunset = profs["strymon-sunset"].model_copy(deep=True)
    sunset.midi.cc_map.append(
        CcDef(cc=53, name="Level", behavior="continuous", evidence=Evidence.DOCUMENTED, min_value=0, max_value=100)
    )
    sunset.midi.cc_map.append(CcDef(cc=54, name="Proposed", review_status="proposed", evidence=Evidence.DOCUMENTED))
    profs["strymon-sunset"] = sunset
    rig = demo_rig()
    scene = rig.scenes[0]
    st = next(s for s in scene.device_states if s.instance_id == "inst_sunset")
    st.cc_values = [CcValue(cc=53, value=120), CcValue(cc=54, value=5), CcValue(cc=53, value=120)]
    plan = compile_rig(rig, profs, build_context(rig, profs))
    sp = next(p for p in plan["scenes"] if p["scene_id"] == scene.id)
    codes = [d["code"] for d in sp["diagnostics"]]
    assert "midi.cc_out_of_range" in codes and "midi.cc_unreviewed" in codes
    sent = [
        (m["number"], m["value"])
        for m in sp["messages"]
        if m["target_instance_id"] == "inst_sunset" and m["type"] == "cc"
    ]
    assert (53, 120) in sent and (54, 5) in sent  # bytes are exactly what the scene says


# --------------------------------------------------------------------------- project files


def test_knowledge_and_notes_travel_in_project_files_and_defaults_are_omitted(tmp_path):
    with TestClient(create_app(tmp_path / "a.sqlite3")) as client:
        pid = "kw-export-pedal"
        assert client.post("/api/catalog/devices", json=_profile_body(pid)).status_code == 201
        did = _attach(client, pid)
        client.put(
            f"/api/catalog/devices/{pid}/controls",
            json={
                "cc_map": [
                    control(
                        12,
                        "Echo Level",
                        behavior="continuous",
                        min_value=0,
                        max_value=127,
                        citation={"document_id": did, "page": 2},
                    )
                ]
            },
        ).raise_for_status()
        client.put(
            f"/api/catalog/devices/{pid}/quick-reference",
            json={
                "notes": [
                    {
                        "id": "note_save",
                        "title": "Save a preset",
                        "category": "presets",
                        "steps": ["Hold FAV"],
                        "references": [{"document_id": did, "page": 3}],
                        "pinned": True,
                    }
                ]
            },
        ).raise_for_status()
        # Detach the document: the profile cites it only through the control and the note now.
        client.delete(f"/api/catalog/devices/{pid}/documents/{did}").raise_for_status()
        rig = client.post("/api/rigs", json={"name": "Knowledge export"}).json()
        rig["instances"].append(
            {
                "id": "inst_kw",
                "profile_id": pid,
                "label": "My pedal",
                "quick_reference": [
                    {
                        "id": "note_unit",
                        "title": "This unit is on channel 7",
                        "category": "midi_setup",
                        "body": "Set 2026-10-23.",
                    }
                ],
            }
        )
        rig["revision"] += 1
        assert client.put(f"/api/rigs/{rig['id']}", json=rig).status_code == 200
        plain = client.get(f"/api/rigs/{rig['id']}/export").json()
        (prof,) = plain["profiles"]
        cc = prof["midi"]["cc_map"][0]
        assert cc["continuous"] is True and cc["citation"]["page"] == 2 and cc["min_value"] == 0
        # Defaults, and a behaviour the legacy flag already implies, are omitted (what older versions wrote).
        assert (
            "behavior" not in cc and "hardware_status" not in cc and "review_status" not in cc and "mapping" not in cc
        )
        assert prof["quick_reference"][0]["id"] == "note_save"
        assert plain["rig"]["instances"][0]["quick_reference"][0]["id"] == "note_unit"
        # A profile without any knowledge is written exactly as before (no Session 6 keys at all).
        demo = next(r for r in client.get("/api/rigs").json() if r["name"].startswith("Demo rig"))
        demo_file = client.get(f"/api/rigs/{demo['id']}/export").json()
        for p in demo_file["profiles"]:
            assert "quick_reference" not in p
            for c in p["midi"]["cc_map"]:
                assert not (
                    {"behavior", "citation", "hardware_status", "review_status", "mapping", "min_value"} & set(c)
                )
        for inst in demo_file["rig"]["instances"]:
            assert "quick_reference" not in inst
        # With documents: the PDF cited only by a control and a note is bundled.
        full = client.get(f"/api/rigs/{rig['id']}/export?include_images=1&include_documents=1&require_complete=1")
        assert full.status_code == 200, full.text
        bundle = full.json()
        assert [d["id"] for d in bundle["documents"]] == [did]

    with TestClient(create_app(tmp_path / "b.sqlite3")) as other:
        res = other.post("/api/rigs/import", content=json.dumps(bundle))
        assert res.status_code == 201, res.text
        prof = other.get(f"/api/catalog/devices/{pid}").json()
        assert prof["midi"]["cc_map"][0]["citation"] == {"document_id": did, "page": 2, "note": None}
        assert prof["midi"]["cc_map"][0]["hardware_status"] == "unverified"
        assert prof["quick_reference"][0]["pinned"] is True and prof["quick_reference"][0]["steps"] == ["Hold FAV"]
        assert prof["document_files"] == [
            {"document_id": did, "present": True, "page_count": 3, "byte_size": len(MANUAL)}
        ]
        assert res.json()["rig"]["instances"][0]["quick_reference"][0]["title"] == "This unit is on channel 7"
        # And the plain file (no PDF) imports too, reporting the missing document rather than dropping the citation.
        res2 = other.post("/api/rigs/import", content=json.dumps(plain))
        assert res2.status_code == 201, res2.text


def test_scrub_is_a_pure_default_filter():
    prof = {
        "midi": {
            "cc_map": [{"cc": 1, "name": "a", "behavior": None, "mapping": "manufacturer_default", "min_value": 5}]
        },
        "quick_reference": [],
    }
    scrub_profile_knowledge(prof)
    assert prof == {"midi": {"cc_map": [{"cc": 1, "name": "a", "min_value": 5}]}}


# --------------------------------------------------------------------------- proposals from page text


def test_proposals_from_page_text_are_marked_proposed_and_cite_the_page(db_path):
    text = "MIDI implementation chart. CC 12 Echo Level 0-127. CC#15 Spacing (0–127). CC 102: Bypass 0 = off, 127 = on. Controller 200 nothing. CC 12 again. CC 80 Tap tempo: any value."
    props = propose_controls(text, DOC, 2)
    by_cc = {p["cc"]: p for p in props}
    assert list(by_cc) == [12, 15, 102, 80]  # ≤ 127 only, first occurrence wins
    assert by_cc[12]["name"] == "Echo Level" and by_cc[12]["min_value"] == 0 and by_cc[12]["max_value"] == 127
    assert by_cc[15]["name"] == "Spacing" and by_cc[15]["max_value"] == 127
    assert by_cc[102]["name"] == "Bypass" and by_cc[102]["behavior"] == "discrete"
    assert by_cc[80]["behavior"] == "trigger"
    for p in props:
        assert p["review_status"] == "proposed" and p["hardware_status"] == "unverified"
        assert p["citation"] == {"document_id": DOC, "page": 2, "note": None}
        CcDef.model_validate({k: v for k, v in p.items() if k != "snippet"})  # every proposal is a valid control
    assert propose_controls("", DOC, 1) == []
    with TestClient(create_app(db_path)) as client:
        pid = "kw-proposals"
        assert client.post("/api/catalog/devices", json=_profile_body(pid)).status_code == 201
        did = _attach(client, pid)
        r = client.get(f"/api/documents/{did}/pages/2/proposals")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["has_text_layer"] is True and [p["cc"] for p in body["proposals"]] == [12, 15, 102]
        assert body["proposals"][0]["citation"]["document_id"] == did
        assert client.get(f"/api/documents/{did}/pages/9/proposals").status_code == 404
        # Nothing was written to the profile.
        assert client.get(f"/api/catalog/devices/{pid}").json()["midi"]["cc_map"] == []
