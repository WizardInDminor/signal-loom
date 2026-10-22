"""Final pre-merge review (PR #7): metadata operations must never write an older snapshot over
newer configuration. Each scenario forces the interleaving with a repository hook (no timing): the
handler's read is observed, a newer write is made to land before the handler's own write, and the
stored result must carry both. A concurrent writer that takes the configuration write lock is run
on a thread through the real API; it is serialised against the handler, in either order."""

from __future__ import annotations

import json
import threading
import time

from fastapi.testclient import TestClient

from app.live.sender import ARM_PHRASE
from app.models.rig import Rig
from app.repo import ProfileRepository, RigRepository

from .support.pdf import make_pdf

PEDAL_A = "signal-loom-virtual-pedal-a"


def undertow(client) -> str:
    return client.post("/api/rigs", json={"name": "Race rig", "template": "virtual_instrument"}).json()["id"]


def newer_configuration(rig: Rig) -> Rig:
    """What another tab's PUT would save: channel, cable, device, scene and texture all changed."""
    newer = Rig.model_validate(rig.model_dump(mode="json"))
    next(i for i in newer.instances if i.id == "inst_vpedal_a").midi_channel = 9
    newer.connections = newer.connections[1:]
    newer.instances = [i for i in newer.instances if i.id != "inst_amp"]
    newer.connections = [c for c in newer.connections if "inst_amp" not in (c.source.instance_id, c.target.instance_id)]
    newer.scenes[0].name = "changed scene"
    newer.textures[0].tempo_bpm = 150
    newer.textures[0].macros[0].mappings[0].output_max = 40
    newer.revision += 1
    return newer


def assert_newer_configuration(stored: dict) -> None:
    assert next(i for i in stored["instances"] if i["id"] == "inst_vpedal_a")["midi_channel"] == 9
    assert len(stored["connections"]) == 1 and not any(i["id"] == "inst_amp" for i in stored["instances"])
    assert stored["scenes"][0]["name"] == "changed scene"
    assert stored["textures"][0]["tempo_bpm"] == 150
    assert stored["textures"][0]["macros"][0]["mappings"][0]["output_max"] == 40


def test_rig_rename_cannot_overwrite_a_newer_configuration_or_regress_the_revision(client, monkeypatch):
    rid = undertow(client)
    before = client.get(f"/api/rigs/{rid}").json()
    real_get, real_save = RigRepository.get, RigRepository.save
    landed = {"n": 0}

    def get_then_lose_the_race(self, rig_id):
        rig = real_get(self, rig_id)
        if rig_id == rid and rig is not None and landed["n"] == 0:
            landed["n"] = 1
            real_save(self, newer_configuration(rig))  # lands between the handler's read and its write
        return rig

    monkeypatch.setattr(RigRepository, "get", get_then_lose_the_race)
    r = client.patch(f"/api/rigs/{rid}", json={"name": "Renamed", "description": "new words"})
    assert r.status_code == 200, r.text
    monkeypatch.undo()
    assert landed["n"] == 1
    stored = client.get(f"/api/rigs/{rid}").json()
    assert stored["name"] == "Renamed" and stored["description"] == "new words"
    assert_newer_configuration(stored)
    assert stored["revision"] == before["revision"] + 1  # the newer revision stands; rename does not regress it
    assert r.json()["name"] == "Renamed" and r.json()["revision"] == before["revision"] + 1
    # Revision semantics are intact: a stale PUT is still refused, a newer one accepted.
    stale = dict(before, name="stale")
    r = client.put(f"/api/rigs/{rid}", json=stale)
    assert r.status_code == 409, r.text
    fresh = client.get(f"/api/rigs/{rid}").json()
    fresh["revision"] += 1
    assert client.put(f"/api/rigs/{rid}", json=fresh).status_code == 200
    assert client.get(f"/api/rigs/{rid}").json()["name"] == "Renamed"


def test_mc8_bank_import_cannot_overwrite_a_concurrent_texture_or_channel_change(client, monkeypatch):
    """The import rewrites the whole document; its read and write share the configuration write
    lock, so a concurrent locked writer (another tab's PUT) is serialised before or after it."""
    rid = undertow(client)
    other = TestClient(client.app)
    real_get = RigRepository.get
    started = threading.Event()
    done = threading.Event()
    result: dict = {}

    def concurrent_put():
        started.set()
        # The ordinary PUT handler: it reads and writes under the configuration write lock itself.
        rig = real_get(RigRepository(client.app.state.db), rid)
        newer = newer_configuration(rig)
        result["status"] = other.put(f"/api/rigs/{rid}", json=newer.model_dump(mode="json")).status_code
        done.set()

    fired = {"n": 0}

    def get_hook(self, rig_id):
        rig = real_get(self, rig_id)
        if rig_id == rid and fired["n"] == 0:
            fired["n"] = 1
            threading.Thread(target=concurrent_put, daemon=True).start()
            started.wait(timeout=2)
            time.sleep(0.15)  # give the writer the chance to race; the lock decides, not this sleep
        return rig

    monkeypatch.setattr(RigRepository, "get", get_hook)
    # A real importable bank: the demo rig's own exported MC8 bank 1.
    dump = client.get("/api/rigs/rig_demo_signal_loom/exports/mc8-bank/1").json()[
        "dump"
    ]  # carries its own hash: unmodified
    r = client.post(f"/api/rigs/{rid}/import/mc8-bank", content=json.dumps(dump))
    monkeypatch.undo()
    assert done.wait(timeout=5), "the concurrent writer never finished: deadlock?"
    stored = client.get(f"/api/rigs/{rid}").json()
    assert r.status_code == 200, r.text
    assert result["status"] == 200, "the concurrent writer must have been serialised, not lost or refused"
    assert_newer_configuration(stored)  # the writer's change stands …
    assert len(stored["controllers"]["mc8"]["banks"]) == 1  # … and so does the imported bank
    assert stored["revision"] >= 2


def commands_body(n: int) -> dict:
    return {
        "commands": [
            {"id": f"cmd_c{i}", "name": f"Cmd {i}", "kind": "cc", "cc": 70 + i, "value_mode": "fixed", "value": 1}
            for i in range(n)
        ]
    }


def run_profile_race(client, monkeypatch, handler, concurrent, profile_id=PEDAL_A):
    """Call ``handler(client)`` while, at its first profile read, ``concurrent(other_client)`` is
    started on a thread. Returns (handler response, concurrent response)."""
    other = TestClient(client.app)
    real_get = ProfileRepository.get
    fired = {"n": 0}
    started, done = threading.Event(), threading.Event()
    result: dict = {}

    def writer():
        started.set()
        result["resp"] = concurrent(other)
        done.set()

    def get_hook(self, pid):
        p = real_get(self, pid)
        if pid == profile_id and fired["n"] == 0:
            fired["n"] = 1
            threading.Thread(target=writer, daemon=True).start()
            started.wait(timeout=2)
            time.sleep(0.15)  # lets an unprotected handler lose the race; a protected one serialises regardless
        return p

    monkeypatch.setattr(ProfileRepository, "get", get_hook)
    resp = handler(client)
    monkeypatch.undo()
    assert done.wait(timeout=10), "the concurrent writer never finished: deadlock?"
    assert fired["n"] == 1
    return resp, result["resp"]


def test_document_rename_cannot_overwrite_a_newer_command_library(client, monkeypatch):
    pdf = make_pdf(["manual"])
    r = client.post(
        f"/api/catalog/devices/{PEDAL_A}/documents",
        files={"file": ("m.pdf", pdf, "application/pdf")},
        data={"title": "Manual"},
    )
    assert r.status_code == 201, r.text
    doc_id = r.json()["documents"][0]["document_id"]
    resp, other = run_profile_race(
        client,
        monkeypatch,
        handler=lambda c: c.patch(
            f"/api/catalog/devices/{PEDAL_A}/documents/{doc_id}", json={"title": "Renamed manual"}
        ),
        concurrent=lambda o: o.put(f"/api/catalog/devices/{PEDAL_A}/commands", json=commands_body(3)),
    )
    assert resp.status_code == 200 and other.status_code == 200
    p = client.get(f"/api/catalog/devices/{PEDAL_A}").json()
    assert p["documents"][0]["title"] == "Renamed manual"
    assert [c["id"] for c in p["midi"]["commands"]] == ["cmd_c0", "cmd_c1", "cmd_c2"]


def test_document_attach_and_detach_preserve_newer_midi_capability_ports_and_commands(client, monkeypatch):
    pdf = make_pdf(["manual"])
    # Attach racing a MIDI-capability declaration (interfaces/default channel).
    resp, other = run_profile_race(
        client,
        monkeypatch,
        handler=lambda c: c.post(
            f"/api/catalog/devices/{PEDAL_A}/documents",
            files={"file": ("m.pdf", pdf, "application/pdf")},
            data={"title": "Manual"},
        ),
        concurrent=lambda o: o.post(
            f"/api/catalog/devices/{PEDAL_A}/midi-capability", json={"interfaces": ["din_in"], "default_channel": 4}
        ),
    )
    assert resp.status_code == 201 and other.status_code == 200
    p = client.get(f"/api/catalog/devices/{PEDAL_A}").json()
    assert len(p["documents"]) == 1 and "din_in" in p["midi"]["interfaces"] and p["midi"]["default_channel"] == 4
    doc_id = p["documents"][0]["document_id"]
    # Detach racing a jack change.
    ports = [pp for pp in p["ports"] if pp["id"] != "dc_in"]
    resp, other = run_profile_race(
        client,
        monkeypatch,
        handler=lambda c: c.delete(f"/api/catalog/devices/{PEDAL_A}/documents/{doc_id}"),
        concurrent=lambda o: o.put(f"/api/catalog/devices/{PEDAL_A}/ports", json={"ports": ports, "force": True}),
    )
    assert resp.status_code == 200 and other.status_code == 200
    p = client.get(f"/api/catalog/devices/{PEDAL_A}").json()
    assert p["documents"] == [] and [pp["id"] for pp in p["ports"]] == [pp["id"] for pp in ports]
    # Replace racing a command change: the profile is not rewritten by a replace at all.
    r = client.post(
        f"/api/catalog/devices/{PEDAL_A}/documents",
        files={"file": ("m.pdf", pdf, "application/pdf")},
        data={"title": "Manual"},
    )
    doc_id = r.json()["documents"][0]["document_id"]
    resp, other = run_profile_race(
        client,
        monkeypatch,
        handler=lambda c: c.post(
            f"/api/catalog/devices/{PEDAL_A}/documents/{doc_id}/replace",
            files={"file": ("n.pdf", make_pdf(["v2"]), "application/pdf")},
        ),
        concurrent=lambda o: o.put(f"/api/catalog/devices/{PEDAL_A}/commands", json=commands_body(2)),
    )
    assert resp.status_code == 200 and other.status_code == 200
    p = client.get(f"/api/catalog/devices/{PEDAL_A}").json()
    assert [c["id"] for c in p["midi"]["commands"]] == ["cmd_c0", "cmd_c1"] and len(p["documents"]) == 1


def test_two_partial_profile_updates_are_both_kept(client, monkeypatch):
    """Commands racing from-map (both read-modify-save on the same field family)."""
    resp, other = run_profile_race(
        client,
        monkeypatch,
        handler=lambda c: c.put(f"/api/catalog/devices/{PEDAL_A}/commands", json=commands_body(1)),
        concurrent=lambda o: o.post(f"/api/catalog/devices/{PEDAL_A}/midi-capability", json={"interfaces": ["trs_in"]}),
    )
    assert resp.status_code == 200 and other.status_code == 200
    p = client.get(f"/api/catalog/devices/{PEDAL_A}").json()
    assert [c["id"] for c in p["midi"]["commands"]] == ["cmd_c0"] and "trs_in" in p["midi"]["interfaces"]


def test_metadata_operations_stay_permitted_while_performing_and_safety_edits_stay_refused(client):
    rid = undertow(client)
    client.post(f"/api/live/rigs/{rid}/bindings/suggest")
    client.post(f"/api/live/rigs/{rid}/connect")
    client.post("/api/live/arm", json={"confirm": ARM_PHRASE})
    assert client.post(f"/api/live/rigs/{rid}/textures/tex_undertow/start", json={}).status_code == 200
    # Metadata: rig rename, document attach/rename/detach on the performing rig's own profile.
    assert client.patch(f"/api/rigs/{rid}", json={"name": "Renamed live"}).status_code == 200
    r = client.post(
        f"/api/catalog/devices/{PEDAL_A}/documents",
        files={"file": ("m.pdf", make_pdf(["x"]), "application/pdf")},
        data={"title": "Manual"},
    )
    assert r.status_code == 201, r.text
    doc_id = r.json()["documents"][0]["document_id"]
    assert (
        client.patch(f"/api/catalog/devices/{PEDAL_A}/documents/{doc_id}", json={"title": "Live manual"}).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/catalog/devices/{PEDAL_A}/documents/{doc_id}/replace",
            files={"file": ("n.pdf", make_pdf(["y"]), "application/pdf")},
        ).status_code
        == 200
    )
    assert client.delete(f"/api/catalog/devices/{PEDAL_A}/documents/{doc_id}?purge=1").status_code == 200
    # Safety-relevant edits still refused.
    rig = client.get(f"/api/rigs/{rid}").json()
    next(i for i in rig["instances"] if i["id"] == "inst_vpedal_a")["midi_channel"] = 5
    rig["revision"] += 1
    r = client.put(f"/api/rigs/{rid}", json=rig)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.performing_locked"
    r = client.put(f"/api/catalog/devices/{PEDAL_A}/commands", json=commands_body(1))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "live.performing_locked"
    # The metadata path did not bypass the guard indirectly: the stream still runs on channel 1.
    st = client.get("/api/live/perform/status").json()
    assert st["state"] == "performing" and [d["channel"] for d in st["destinations"]] == [1, 2]
    assert client.get(f"/api/rigs/{rid}").json()["name"] == "Renamed live"
    # No deadlock when Stop and Disarm intersect metadata writes from other threads.
    other = TestClient(client.app)
    stop_flag = threading.Event()
    errors: list = []

    def churn():
        i = 0
        while not stop_flag.is_set():
            try:
                other.patch(f"/api/rigs/{rid}", json={"name": f"n{i}"})
                other.post(
                    f"/api/catalog/devices/{PEDAL_A}/documents",
                    files={"file": ("m.pdf", make_pdf(["z"]), "application/pdf")},
                    data={"title": "T"},
                )
            except Exception as e:  # pragma: no cover - surfaced below
                errors.append(e)
            i += 1

    t = threading.Thread(target=churn, daemon=True)
    t.start()
    time.sleep(0.2)
    assert client.post("/api/live/perform/stop").status_code == 200
    assert client.post("/api/live/disarm").status_code == 200
    assert client.post(f"/api/live/rigs/{rid}/connect").status_code == 200
    stop_flag.set()
    t.join(timeout=10)
    assert not t.is_alive() and not errors
    assert client.get("/api/live/status").json()["armed"] is False
    client.post("/api/live/disconnect")
    client.delete("/api/documents/unreferenced")
    profile = client.get(f"/api/catalog/devices/{PEDAL_A}").json()
    assert profile["midi"]["cc_map"][0]["continuous"] is True  # untouched by all the metadata churn
