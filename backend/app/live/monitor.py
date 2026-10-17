"""Incoming MIDI: decode for display and compare with compiled scene plans.

Receive callbacks arrive on a transport thread and only append to a bounded, locked deque; the
API thread reads it. The *scene follower* is deliberately modest: it reports "possible active
scene" when the recent messages contain every PC/CC of exactly one compiled scene, "ambiguous"
when several scenes match equally (or a partial match exists), and "no evidence" otherwise. It
never says which footswitch was pressed and never claims a pedal changed state: what was observed
is MIDI on a computer input, nothing more.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass

from ..models.rig import utcnow_iso
from .transport import MidiMessage, decode


@dataclass
class Observed:
    seq: int
    at: str
    monotonic: float
    endpoint_id: str
    endpoint_name: str
    message: MidiMessage

    def as_dict(self) -> dict:
        return {
            "seq": self.seq,
            "at": self.at,
            "endpoint_id": self.endpoint_id,
            "endpoint_name": self.endpoint_name,
            **self.message.as_dict(),
            "summary": self.message.summary(),
        }


class LiveMonitor:
    LIMIT = 2000

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._items: deque[Observed] = deque(maxlen=self.LIMIT)
        self._seq = 0
        self._names: dict[str, str] = {}

    def name_endpoint(self, endpoint_id: str, name: str) -> None:
        with self._lock:
            self._names[endpoint_id] = name

    def on_receive(self, endpoint_id: str, data: bytes) -> None:
        """Transport-thread callback: decode and store, nothing else (never blocks the event loop)."""
        msg = decode(data)
        with self._lock:
            self._seq += 1
            self._items.append(
                Observed(
                    self._seq,
                    utcnow_iso(),
                    time.monotonic(),
                    endpoint_id,
                    self._names.get(endpoint_id, endpoint_id),
                    msg,
                )
            )

    def observed(self, since: int = 0, limit: int = 200) -> list[Observed]:
        with self._lock:
            return [o for o in self._items if o.seq > since][-limit:]

    @property
    def seq(self) -> int:
        with self._lock:
            return self._seq

    def clear(self) -> None:
        with self._lock:
            self._items.clear()

    def last_per_channel(self) -> dict[int, dict]:
        """Last PC and CC values seen per channel (observation on a computer input, not pedal state)."""
        out: dict[int, dict] = {}
        with self._lock:
            for o in self._items:
                m = o.message
                if m.channel is None:
                    continue
                ch = out.setdefault(
                    m.channel, {"program": None, "cc": {}, "at": None, "endpoint_name": o.endpoint_name}
                )
                if m.type == "pc":
                    ch["program"] = m.number
                elif m.type == "cc":
                    ch["cc"][str(m.number)] = m.value
                ch["at"] = o.at
        return out

    def follow(self, scene_plans: list[dict], window_s: float = 5.0) -> dict:
        """Compare the last ``window_s`` seconds of observations with compiled scene plans."""
        now = time.monotonic()
        with self._lock:
            recent = [o for o in self._items if now - o.monotonic <= window_s]
        seen = {(o.message.type, o.message.channel, o.message.number, o.message.value) for o in recent}
        candidates = []
        for plan in scene_plans:
            msgs = plan.get("messages", [])
            if not msgs:
                continue
            want = {(m["type"], m["channel"], m["number"], m["value"]) for m in msgs}
            matched = len(want & seen)
            if matched:
                candidates.append(
                    {
                        "scene_id": plan["scene_id"],
                        "scene_name": plan["scene_name"],
                        "matched": matched,
                        "total": len(want),
                        "complete": matched == len(want),
                    }
                )
        candidates.sort(key=lambda c: (-c["complete"], -c["matched"] / max(1, c["total"]), c["scene_name"]))
        complete = [c for c in candidates if c["complete"]]
        if not recent or not candidates:
            status, text = "no_evidence", "No observed messages match a compiled scene in the last few seconds."
        elif len(complete) == 1:
            status = "possible"
            text = (
                f"Observed messages contain every message of '{complete[0]['scene_name']}'. This is consistent with that scene having been "
                "recalled; it does not prove which footswitch was pressed or that any pedal changed state."
            )
        elif len(complete) > 1:
            status = "ambiguous"
            text = f"Observed messages match {len(complete)} scenes equally ({', '.join(c['scene_name'] for c in complete)}); the evidence cannot tell them apart."
        else:
            status = "ambiguous"
            text = f"Only part of '{candidates[0]['scene_name']}' was observed ({candidates[0]['matched']}/{candidates[0]['total']} messages); the evidence is incomplete."
        return {
            "status": status,
            "text": text,
            "candidates": candidates[:5],
            "observed_count": len(recent),
            "window_s": window_s,
        }
