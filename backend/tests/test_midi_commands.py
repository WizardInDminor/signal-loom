"""Session 3f, Parts B and C: named MIDI commands on profiles and their use in scenes.

The reproducibility rule under test: a scene stores the bytes it will send plus a snapshot of the
command they came from; editing or deleting the command later changes diagnostics, never bytes.
"""

from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from app.domain.commands import CommandApplyError, apply_cc, apply_pc, commands_from_midi_spec
from app.domain.compiler import compile_rig
from app.domain.wiring import build_context
from app.exports.text import scene_report_markdown
from app.models.common import Evidence
from app.models.profile import CommandCitation, MidiCommand, ValueChoice
from app.models.rig import CcValue

from .support.pdf import make_pdf


def plan_for(rig, profiles):
    return compile_rig(rig, profiles, build_context(rig, profiles))


def engage_a() -> MidiCommand:
    return MidiCommand(
        id="cmd_engage_a",
        name="Engage A side",
        category="Bypass",
        favorite=True,
        kind="cc",
        cc=10,
        value_mode="fixed",
        value=127,
        intent="engage",
        deterministic=True,
        evidence=Evidence.DOCUMENTED,
        citation=CommandCitation(document_id="doc_0123456789ab", page=2),
    )


def mix_choice() -> MidiCommand:
    return MidiCommand(
        id="cmd_b_side",
        name="B side",
        kind="cc",
        cc=15,
        value_mode="choice",
        choices=[ValueChoice(value=0, label="bypass"), ValueChoice(value=127, label="engage")],
        intent="set",
        deterministic=True,
        evidence=Evidence.DOCUMENTED,
    )


# --------------------------------------------------------------------------- model rules


def test_command_model_refuses_invented_or_contradictory_data():
    with pytest.raises(ValidationError, match="needs its value"):
        MidiCommand(id="cmd_x", name="No value", kind="cc", cc=10)
    with pytest.raises(ValidationError, match="controller number"):
        MidiCommand(id="cmd_x", name="No cc", kind="cc", value=1)
    with pytest.raises(ValidationError, match="cannot carry CC data"):
        MidiCommand(id="cmd_x", name="Mixed", kind="pc", pc=1, cc=10)
    with pytest.raises(ValidationError, match="program number"):
        MidiCommand(id="cmd_x", name="No pc", kind="pc")
    with pytest.raises(ValidationError, match="toggle command cannot be deterministic"):
        MidiCommand(id="cmd_x", name="Toggle", kind="cc", cc=1, value=127, intent="toggle", deterministic=True)
    with pytest.raises(ValidationError, match="distinct"):
        MidiCommand(
            id="cmd_x",
            name="Dup",
            kind="cc",
            cc=1,
            value_mode="choice",
            choices=[ValueChoice(value=0, label="a"), ValueChoice(value=0, label="b")],
        )
    with pytest.raises(ValidationError):
        MidiCommand(id="cmd_x", name="Range", kind="cc", cc=128, value=1)
    with pytest.raises(ValidationError):
        MidiCommand(id="bad id!", name="Id", kind="cc", cc=1, value=1)
    # Unknown is allowed and stays unknown: a toggle's determinism is derived, nothing else is.
    t = MidiCommand(id="cmd_t", name="Toggle", kind="cc", cc=1, value=127, intent="toggle")
    assert t.deterministic is False
    any_cmd = MidiCommand(id="cmd_a", name="Mix", kind="cc", cc=20, value_mode="any", evidence=Evidence.UNKNOWN)
    assert any_cmd.value is None and any_cmd.deterministic is None and any_cmd.wire_summary() == "CC 20 = <value>"


def test_fingerprint_tracks_wire_definition_only():
    a = engage_a()
    b = a.model_copy(
        update={"name": "Engage (renamed)", "favorite": False, "description": "x", "evidence": Evidence.USER}
    )
    assert a.fingerprint() == b.fingerprint() == "cc 10 127 intent=engage deterministic=yes"
    assert a.model_copy(update={"value": 100}).fingerprint() != a.fingerprint()
    pc = MidiCommand(id="cmd_p", name="Lead", kind="pc", pc=4, bank_msb=1)
    assert pc.fingerprint() == "pc 4 bank 1/- intent=- deterministic=unknown"
    assert pc.wire_summary() == "PC 4 (bank MSB 1 / LSB -)"


# --------------------------------------------------------------------------- relationship to the documented map


def test_commands_derived_from_the_documented_map_copy_its_evidence(profiles):
    sunset = profiles["strymon-sunset"]
    derived = commands_from_midi_spec(sunset.midi)
    by_id = {c.id: c for c in derived}
    eng, byp = by_id["cmd_engage-cc10"], by_id["cmd_bypass-cc10"]
    assert (eng.cc, eng.value, eng.intent, eng.deterministic, eng.evidence) == (
        10,
        127,
        "engage",
        True,
        Evidence.DOCUMENTED,
    )
    assert (byp.cc, byp.value, byp.intent) == (10, 0, "bypass")
    # CC map entries become "any value" commands with the semantics text as description; no numbers parsed.
    b_side = next(c for c in derived if c.cc == 15)
    assert b_side.value_mode == "any" and b_side.value is None and "0 = bypass" in (b_side.description or "")
    exp = next(c for c in derived if c.cc == 100)
    assert exp.evidence == Evidence.UNKNOWN
    pc = by_id["cmd_recall-program"]
    assert (pc.kind, pc.pc, pc.evidence) == ("pc", 0, Evidence.DOCUMENTED)
    # Deriving again adds nothing (wire definitions already present).
    midi = sunset.midi.model_copy(update={"commands": derived})
    assert commands_from_midi_spec(midi) == []
    # A profile without any documented MIDI (Pedal Playground style) derives nothing: nothing is invented.
    assert commands_from_midi_spec(profiles["eqd-plumes"].midi) == []


def test_apply_writes_exact_bytes_and_a_snapshot():
    cv = apply_cc(engage_a())
    assert (cv.cc, cv.value, cv.label) == (10, 127, "Engage A side")
    assert cv.command.command_id == "cmd_engage_a" and cv.command.definition == engage_a().fingerprint()
    assert cv.command.deterministic is True and cv.command.value_label is None
    chosen = apply_cc(mix_choice(), 127)
    assert chosen.value == 127 and chosen.command.value_label == "engage"
    with pytest.raises(CommandApplyError, match="not one of the documented values"):
        apply_cc(mix_choice(), 64)
    with pytest.raises(CommandApplyError, match="needs a value"):
        apply_cc(MidiCommand(id="cmd_a", name="Mix", kind="cc", cc=20, value_mode="any"))
    pc = apply_pc(MidiCommand(id="cmd_p", name="Lead", kind="pc", pc=4, bank_msb=1))
    assert (pc.pc, pc.bank_msb, pc.bank_lsb, pc.command.name) == (4, 1, None, "Lead")
    with pytest.raises(CommandApplyError):
        apply_pc(engage_a())


# --------------------------------------------------------------------------- compiler


def _with_commands(profiles, *cmds):
    sunset = profiles["strymon-sunset"].model_copy(deep=True)
    sunset.midi.commands = list(cmds)
    return {**profiles, "strymon-sunset": sunset}


def _sunset_state(scene):
    return next(s for s in scene.device_states if s.instance_id == "inst_sunset")


def test_cc_favorite_compiles_with_instance_channel_into_scene_and_mc8_plan(demo, profiles):
    profs = _with_commands(profiles, engage_a())
    st = _sunset_state(demo.scenes[1])  # Heavy verse: Sunset engaged, PC 1
    st.enabled = None  # the command replaces the generic bypass intent
    st.cc_values = [apply_cc(engage_a())]
    plan = plan_for(demo, profs)
    heavy = plan["scenes"][1]
    msg = next(m for m in heavy["messages"] if m["source_kind"] == "device_cc")
    # Channel 3 is the placed instance's override (the profile default is 1).
    assert (msg["channel"], msg["number"], msg["value"], msg["target_label"], msg["deterministic"]) == (
        3,
        10,
        127,
        "Sunset",
        True,
    )
    assert msg["summary"] == "CC 10 = 127 ch 3 -> Sunset"
    assert "applies 'Engage A side'" in msg["explanation"]
    switch_b = next(s for s in plan["mc8"]["banks"][0]["switches"] if s["position"] == "B")
    assert any(m["summary"] == "CC 10 = 127 ch 3 -> Sunset" for m in switch_b["messages"])
    assert not any(d["severity"] == "error" for d in heavy["diagnostics"])
    assert not any(d["code"].startswith("midi.command") for d in heavy["diagnostics"])
    # The report names the command and the exact bytes, and says what it is not.
    md = scene_report_markdown(demo, plan)
    assert "'Engage A side' (CC10=127)" in md and "not a record of what any device has been observed to do" in md


def test_pc_command_keeps_wire_value_and_display_numbering_apart(demo, profiles):
    bigsky = profiles["strymon-bigsky-mx"].model_copy(deep=True)
    bigsky.midi.program_change.display_numbering = "one_based"
    lead = MidiCommand(
        id="cmd_lead", name="Lead verb", kind="pc", pc=4, bank_msb=0, intent="recall", deterministic=True
    )
    bigsky.midi.commands = [lead]
    profs = {**profiles, "strymon-bigsky-mx": bigsky}
    st = next(s for s in demo.scenes[0].device_states if s.instance_id == "inst_bigsky")
    st.program = apply_pc(lead)
    plan = plan_for(demo, profs)
    pc = next(m for m in plan["scenes"][0]["messages"] if m["type"] == "pc" and m["target_label"] == "BigSky MX")
    assert pc["number"] == 4 and pc["channel"] == 2
    assert "applies 'Lead verb'" in pc["explanation"] and "shown as preset 5 on the device" in pc["explanation"]
    bank = next(
        m
        for m in plan["scenes"][0]["messages"]
        if m["source_kind"] == "device_bank" and m["target_label"] == "BigSky MX"
    )
    assert (bank["number"], bank["value"]) == (0, 0)


def test_toggle_unknown_and_conflicting_commands_are_flagged_not_corrected(demo, profiles):
    toggle = MidiCommand(id="cmd_tog", name="Toggle A", kind="cc", cc=10, value=127, intent="toggle")
    mystery = MidiCommand(id="cmd_myst", name="Mystery knob", kind="cc", cc=77, value=64, evidence=Evidence.UNKNOWN)
    profs = _with_commands(profiles, toggle, mystery)
    st = _sunset_state(demo.scenes[0])  # Clean intro: Sunset bypassed (CC 10 = 0 via the bypass spec)
    st.cc_values = [apply_cc(toggle), apply_cc(mystery)]
    plan = plan_for(demo, profs)
    clean = plan["scenes"][0]
    codes = {d["code"] for d in clean["diagnostics"]}
    assert {"midi.command_toggle", "midi.command_unverified", "midi.cc_undocumented", "scene.cc_conflict"} <= codes
    conflict = next(d for d in clean["diagnostics"] if d["code"] == "scene.cc_conflict")
    assert (
        conflict["severity"] == "error"
        and "127 (Toggle A)" in conflict["message"]
        and "0 (bypassed)" in conflict["message"]
    )
    tog = next(m for m in clean["messages"] if m["number"] == 10 and m["value"] == 127)
    assert tog["deterministic"] is False
    # Both instructions are still listed: nothing is dropped or "corrected" behind the user's back.
    assert sorted(m["value"] for m in clean["messages"] if m["number"] == 10 and m["target_label"] == "Sunset") == [
        0,
        127,
    ]
    # Same value twice is only informational.
    st.enabled = True
    st.cc_values = [apply_cc(engage_a())]
    profs = _with_commands(profiles, engage_a())
    d2 = plan_for(demo, profs)["scenes"][0]["diagnostics"]
    assert any(d["code"] == "scene.cc_repeated" for d in d2) and not any(d["code"] == "scene.cc_conflict" for d in d2)
    # Out-of-range data is refused by the model, not clamped.
    with pytest.raises(ValidationError):
        CcValue(cc=10, value=200)


def test_changing_or_deleting_a_used_command_never_changes_saved_bytes(demo, profiles):
    profs = _with_commands(profiles, engage_a())
    st = _sunset_state(demo.scenes[1])
    st.enabled = None
    st.cc_values = [apply_cc(engage_a())]
    before = plan_for(demo, profs)["scenes"][1]
    bytes_before = [(m["type"], m["channel"], m["number"], m["value"]) for m in before["messages"]]
    # 1. Rename and un-favorite: nothing to review.
    renamed = engage_a().model_copy(update={"name": "Engage drive A", "favorite": False})
    after = plan_for(demo, _with_commands(profiles, renamed))["scenes"][1]
    assert [(m["type"], m["channel"], m["number"], m["value"]) for m in after["messages"]] == bytes_before
    assert not any(d["code"].startswith("midi.command") for d in after["diagnostics"])
    # 2. Edit the value: same bytes, review warning naming old and new definition.
    edited = engage_a().model_copy(update={"value": 100})
    after = plan_for(demo, _with_commands(profiles, edited))["scenes"][1]
    assert [(m["type"], m["channel"], m["number"], m["value"]) for m in after["messages"]] == bytes_before
    changed = next(d for d in after["diagnostics"] if d["code"] == "midi.command_changed")
    assert changed["severity"] == "warning" and "cc 10 127" in changed["message"] and "cc 10 100" in changed["message"]
    # 3. Delete the command: same bytes, removal warning.
    after = plan_for(demo, _with_commands(profiles))["scenes"][1]
    assert [(m["type"], m["channel"], m["number"], m["value"]) for m in after["messages"]] == bytes_before
    assert any(d["code"] == "midi.command_removed" for d in after["diagnostics"])
    # 4. Reapplying deliberately is what changes the bytes.
    st.cc_values = [apply_cc(edited)]
    reapplied = plan_for(demo, _with_commands(profiles, edited))["scenes"][1]
    assert any(m["number"] == 10 and m["value"] == 100 for m in reapplied["messages"])
    assert not any(d["code"].startswith("midi.command") for d in reapplied["diagnostics"])


# --------------------------------------------------------------------------- API, persistence, import


def test_command_api_round_trip_usage_and_derivation(client):
    prof = client.get("/api/catalog/devices/strymon-sunset").json()
    cmd = engage_a().model_dump(mode="json")
    r = client.put("/api/catalog/devices/strymon-sunset/commands", json={"commands": [cmd]})
    assert r.status_code == 200, r.text
    assert r.json()["midi"]["commands"][0]["favorite"] is True and r.json()["source"] == "custom"
    # The documented map is untouched by the command library edit.
    assert r.json()["midi"]["cc_map"] == prof["midi"]["cc_map"] and r.json()["midi"]["bypass"] == prof["midi"]["bypass"]
    # Validation errors from the model surface as 422 with the reason.
    bad = {**cmd, "id": "cmd_bad", "value": None}
    r = client.put("/api/catalog/devices/strymon-sunset/commands", json={"commands": [cmd, bad]})
    assert r.status_code == 422 and "needs its value" in r.text
    r = client.put("/api/catalog/devices/strymon-sunset/commands", json={"commands": [cmd, cmd]})
    assert r.status_code == 422 and "unique" in r.text
    # Derive the rest from the documented map; the existing command is kept, equivalents skipped.
    r = client.post("/api/catalog/devices/strymon-sunset/commands/from-map")
    assert r.status_code == 200
    ids = [c["id"] for c in r.json()["profile"]["midi"]["commands"]]
    assert ids[0] == "cmd_engage_a" and "cmd_bypass-cc10" in r.json()["added"] and "cmd_engage-cc10" not in ids
    # Apply in the demo rig through the normal rig save, then read the usage back.
    rig = client.get("/api/rigs/rig_demo_signal_loom").json()
    scene = next(s for s in rig["scenes"] if s["id"] == "scene_heavy")
    st = next(s for s in scene["device_states"] if s["instance_id"] == "inst_sunset")
    st["enabled"] = None
    st["cc_values"] = [apply_cc(engage_a()).model_dump(mode="json")]
    rig["revision"] += 1
    assert client.put("/api/rigs/rig_demo_signal_loom", json=rig).status_code == 200
    usage = client.get("/api/catalog/devices/strymon-sunset/command-usage").json()
    assert usage["cmd_engage_a"][0]["scene_name"] == "Heavy verse" and usage["cmd_engage_a"][0]["changed"] is False
    analysis = client.get("/api/rigs/rig_demo_signal_loom/analysis").json()
    heavy = next(s for s in analysis["compiled"]["scenes"] if s["scene_id"] == "scene_heavy")
    assert any(m["summary"] == "CC 10 = 127 ch 3 -> Sunset" for m in heavy["messages"])
    # Change the definition on the profile: usage says so, the saved scene still compiles the same bytes.
    cmds = r.json()["profile"]["midi"]["commands"]
    cmds[0]["value"] = 100
    assert client.put("/api/catalog/devices/strymon-sunset/commands", json={"commands": cmds}).status_code == 200
    usage = client.get("/api/catalog/devices/strymon-sunset/command-usage").json()
    assert usage["cmd_engage_a"][0]["changed"] is True and usage["cmd_engage_a"][0]["removed"] is False
    analysis = client.get("/api/rigs/rig_demo_signal_loom/analysis").json()
    heavy = next(s for s in analysis["compiled"]["scenes"] if s["scene_id"] == "scene_heavy")
    assert any(m["summary"] == "CC 10 = 127 ch 3 -> Sunset" for m in heavy["messages"])
    assert any(d["code"] == "midi.command_changed" for d in heavy["diagnostics"])
    assert "'Engage A side' (CC10=127)" in client.get("/api/rigs/rig_demo_signal_loom/exports/scenes.md").text
    # Export/import keeps the library and the applied snapshot (plain format 1 file).
    exported = client.get("/api/rigs/rig_demo_signal_loom/export").json()
    assert exported["format_version"] == 1
    sunset = next(p for p in exported["profiles"] if p["id"] == "strymon-sunset")
    assert sunset["midi"]["commands"][0]["id"] == "cmd_engage_a"
    res = client.post("/api/rigs/import", content=json.dumps(exported)).json()
    imported = client.get(f"/api/rigs/{res['rig']['id']}").json()
    st2 = next(
        s
        for s in next(s for s in imported["scenes"] if s["id"] == "scene_heavy")["device_states"]
        if s["instance_id"] == "inst_sunset"
    )
    assert st2["cc_values"][0]["command"]["command_id"] == "cmd_engage_a" and st2["cc_values"][0]["value"] == 127


def test_imported_profile_without_midi_gets_capability_only_by_explicit_claim(client):
    body = {
        "id": "pp-mystery",
        "manufacturer": "Pedal Playground",
        "model": "Mystery",
        "provenance": {"source": "pedalplayground_import", "evidence": "third_party"},
        "footprint": {
            "width": {"value_mm": 70, "evidence": "third_party"},
            "depth": {"value_mm": 120, "evidence": "third_party"},
            "height": {},
        },
        "declared_unknowns": ["ports (not in dataset)", "midi (not in dataset)"],
    }
    assert client.post("/api/catalog/devices", json=body).status_code == 201
    # A command may be written down before the capability is declared...
    cmd = {
        "id": "cmd_eng",
        "name": "Engage",
        "kind": "cc",
        "cc": 20,
        "value": 127,
        "intent": "engage",
        "deterministic": True,
        "evidence": "user",
    }
    assert client.put("/api/catalog/devices/pp-mystery/commands", json={"commands": [cmd]}).status_code == 200
    rig = client.post("/api/rigs", json={"name": "PP rig"}).json()
    rig["instances"].append({"profile_id": "pp-mystery", "label": "Mystery", "id": "inst_m", "midi_channel": 5})
    rig["scenes"].append(
        {
            "name": "One",
            "id": "scene_one",
            "device_states": [
                {"instance_id": "inst_m", "cc_values": [apply_cc(MidiCommand(**cmd)).model_dump(mode="json")]}
            ],
        }
    )
    rig["revision"] += 1
    assert client.put(f"/api/rigs/{rig['id']}", json=rig).status_code == 200
    # ...but without a declared MIDI input the scene cannot be compiled, and says so.
    a = client.get(f"/api/rigs/{rig['id']}/analysis").json()
    assert any(d["code"] == "scene.device_not_midi" for d in a["compiled"]["scenes"][0]["diagnostics"])
    # The user states the capability explicitly: recorded as their claim, never as documented.
    r = client.post(
        "/api/catalog/devices/pp-mystery/midi-capability", json={"interfaces": ["din_in"], "default_channel": 1}
    )
    assert r.status_code == 200
    midi = r.json()["midi"]
    assert midi["interfaces"] == ["din_in"] and midi["evidence"] == "user" and "declared by the user" in midi["note"]
    assert midi["cc_map"] == [] and midi["program_change"]["supported"] is None
    a = client.get(f"/api/rigs/{rig['id']}/analysis").json()
    one = a["compiled"]["scenes"][0]
    assert any(m["summary"] == "CC 20 = 127 ch 5 -> Mystery" for m in one["messages"])
    codes = {d["code"] for d in one["diagnostics"]}
    assert (
        "scene.device_not_midi" not in codes and "midi.cc_undocumented" in codes
    )  # sent, but not pretended documented
    # Attaching a manual to such a profile and citing it documents the command; hardware stays a separate claim.
    pdf = make_pdf(["CC 20 engages the effect"])
    r = client.post(
        "/api/catalog/devices/pp-mystery/documents",
        files={"file": ("m.pdf", pdf, "application/pdf")},
        data={"title": "Leaflet"},
    )
    doc_id = r.json()["documents"][0]["document_id"]
    cited = {**cmd, "evidence": "documented", "citation": {"document_id": doc_id, "page": 1}}
    r = client.put("/api/catalog/devices/pp-mystery/commands", json={"commands": [cited]})
    assert r.status_code == 200 and r.json()["midi"]["commands"][0]["verified_on_hardware"] is False
    assert client.get(f"/api/documents/{doc_id}").json()["referenced_by"] == ["pp-mystery"]
    # Detaching the manual leaves the citation (reported through document_files as not attached/present).
    client.delete(f"/api/catalog/devices/pp-mystery/documents/{doc_id}?purge=1")
    prof = client.get("/api/catalog/devices/pp-mystery").json()
    assert (
        prof["documents"] == []
        and prof["document_files"][0]["document_id"] == doc_id
        and prof["document_files"][0]["present"]
    )
    assert client.get(f"/api/documents/{doc_id}").status_code == 200, "still cited, so purge did not delete it"
