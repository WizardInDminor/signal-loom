"""Per-conductor signal path tracing through ML10X presets.

Stereo is not a label on a cable here: every conductor (Input Tip, Input Ring, each loop's
Tip/Ring send and return, Output Tip, Output Ring) is a node, a preset defines which
conductors feed which, and the physical cables decide which device actually sits in a loop.
The result tells a user exactly how the left and right signals travel, physically and
logically, and flags the places where the two disagree.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..models.common import Diagnostic, Severity
from ..models.rig import Ml10xPreset
from ..morningstar import specs
from .ml10x import LoopOccupancy, Ml10xTopology

INPUT_NODES = ("IN_TIP", "IN_RING")
OUTPUT_NODES = ("OUT_TIP", "OUT_RING")
ALIASES = {"IN": "IN_TIP", "OUT": "OUT_TIP"}


def normalize_node(n: str) -> str:
    n = n.strip().upper()
    return ALIASES.get(n, n)


def is_loop(n: str) -> bool:
    return n.startswith("L") and n[1:].isdigit() and 1 <= int(n[1:]) <= 10


def loop_no(n: str) -> int:
    return int(n[1:])


def preset_edges(preset: Ml10xPreset) -> list[tuple[str, str]]:
    """Normalized directed edges for either mode. Simple chains become IN_TIP -> ... -> OUT_TIP."""
    if preset.mode == "advanced":
        out: list[tuple[str, str]] = []
        for e in preset.advanced_edges:
            if len(e) == 2:
                out.append((normalize_node(e[0]), normalize_node(e[1])))
        return out
    nodes = ["IN_TIP", *[f"L{n}" for n in preset.chain], "OUT_TIP"]
    return [(nodes[i], nodes[i + 1]) for i in range(len(nodes) - 1)]


@dataclass
class PathStep:
    node: str
    label: str  # "Input (Tip)", "Loop 5 — C Tip", "Output (Ring)"
    device: str | None = None  # device label sitting in the loop (from cables)
    device_instance_id: str | None = None
    state: str = "through"  # "through" | "engaged" | "bypassed" | "return_only" | "missing"
    send_jack: str | None = None
    return_jack: str | None = None
    note: str | None = None
    # Physical facts behind the step: the switcher jack the conductor leaves through (a Send or
    # the main Output), the jack it comes back in through (a Return or the main Input), and the
    # cables plugged into them, in signal order. Empty when nothing is cabled.
    out_port_id: str | None = None
    in_port_id: str | None = None
    cables: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        d = self.__dict__.copy()
        d["cables"] = list(self.cables)
        return d


@dataclass
class ConductorPath:
    name: str  # "Left" / "Right"
    source: str  # start node
    steps: list[PathStep] = field(default_factory=list)
    ends_at: list[str] = field(default_factory=list)  # output nodes reached
    branches: list[list[str]] = field(default_factory=list)  # extra branch node sequences when the graph splits
    complete: bool = False
    summary: str = ""

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "source": self.source,
            "steps": [s.as_dict() for s in self.steps],
            "ends_at": self.ends_at,
            "branches": self.branches,
            "complete": self.complete,
            "summary": self.summary,
        }


def _loop_label(n: int) -> str:
    return f"Loop {n} — {specs.ML10X_LOOP_NAMES[n]}"


def _node_label(node: str) -> str:
    if node == "IN_TIP":
        return "Input (Tip)"
    if node == "IN_RING":
        return "Input (Ring)"
    if node == "OUT_TIP":
        return "Output (Tip)"
    if node == "OUT_RING":
        return "Output (Ring)"
    if is_loop(node):
        return _loop_label(loop_no(node))
    return node


def _loop_step(lp: LoopOccupancy | None, n: int, bypassed: bool) -> PathStep:
    pair = specs.ML10X_LOOP_PAIRS[(n - 1) // 2]
    cond = "Tip" if n % 2 == 1 else "Ring"
    step = PathStep(
        node=f"L{n}", label=_loop_label(n), send_jack=f"Send {pair} ({cond})", return_jack=f"Return {pair} ({cond})"
    )
    if lp is not None:
        step.out_port_id = lp.send_port_id
        step.in_port_id = lp.return_port_id
        step.cables = [c for c in (lp.send_connection_id, lp.return_connection_id) if c]
    if lp is None or not lp.occupied:
        step.state = "missing"
        step.note = "no device cabled into this loop; the signal still passes through the buffered loop"
    elif not lp.complete:
        step.state = "missing"
        step.note = "loop is only half cabled: the path breaks here"
    else:
        step.device = lp.send_to_label
        step.device_instance_id = lp.send_to_instance_id
        if lp.return_from_instance_id and lp.return_from_instance_id != lp.send_to_instance_id:
            step.note = f"return comes from {lp.return_from_label} (devices chained inside the loop)"
        step.state = "bypassed" if bypassed else "engaged"
    return step


def trace_preset(topo: Ml10xTopology | None, preset: Ml10xPreset) -> dict:
    """Trace every conductor from the inputs (and from return-only loops) to the outputs."""
    edges = preset_edges(preset)
    succ: dict[str, list[str]] = {}
    has_in: set[str] = set()
    nodes: set[str] = set()
    for a, b in edges:
        succ.setdefault(a, []).append(b)
        has_in.add(b)
        nodes.update((a, b))
    bypassed = set(preset.bypassed_loops)
    diags: list[Diagnostic] = []
    subj = f"ml10x-preset-{preset.number}"

    def walk(start: str, name: str) -> ConductorPath:
        path = ConductorPath(name=name, source=start)
        seen: set[str] = set()
        order: list[str] = []
        stack = [start]
        # Deterministic DFS collecting the primary chain; splits are recorded as branches.
        main: list[str] = []
        cur: str | None = start
        while cur is not None and cur not in seen:
            seen.add(cur)
            main.append(cur)
            nxt = succ.get(cur, [])
            if len(nxt) > 1:
                for extra in nxt[1:]:
                    path.branches.append([cur, extra, *_follow(extra, succ, seen.copy())])
            cur = nxt[0] if nxt else None
        order = main
        del stack
        for node in order:
            if node in INPUT_NODES:
                fed_by = topo.input_from.get(node) if topo else None
                path.steps.append(
                    PathStep(
                        node=node,
                        label=_node_label(node),
                        state="through",
                        device=fed_by,
                        note=f"fed by {fed_by}" if fed_by else "nothing is cabled into this input",
                        in_port_id=topo.input_port_id.get(node) if topo else None,
                        cables=[topo.input_connection_id[node]] if topo and node in topo.input_connection_id else [],
                    )
                )
            elif node in OUTPUT_NODES:
                drives = topo.output_to.get(node) if topo else None
                path.steps.append(
                    PathStep(
                        node=node,
                        label=_node_label(node),
                        state="through",
                        device=drives,
                        note=f"feeds {drives}" if drives else "this output is not cabled anywhere",
                        out_port_id=topo.output_port_id.get(node) if topo else None,
                        cables=[topo.output_connection_id[node]] if topo and node in topo.output_connection_id else [],
                    )
                )
                path.ends_at.append(node)
            elif is_loop(node):
                n = loop_no(node)
                path.steps.append(_loop_step(topo.loop(n) if topo else None, n, n in bypassed))
            else:
                path.steps.append(PathStep(node=node, label=node, state="missing", note="unknown node"))
        for br in path.branches:
            for node in br:
                if node in OUTPUT_NODES and node not in path.ends_at:
                    path.ends_at.append(node)
        path.complete = bool(path.ends_at) and not any(
            s.state == "missing" and s.note and "breaks" in s.note for s in path.steps
        )
        path.summary = _summary(path)
        return path

    paths: list[ConductorPath] = []
    if "IN_TIP" in nodes or preset.mode == "simple":
        paths.append(walk("IN_TIP", "Left (Input Tip)"))
    if "IN_RING" in nodes:
        paths.append(walk("IN_RING", "Right (Input Ring)"))
    # Return-only loops: a loop that feeds something but nothing feeds it. This is the documented
    # mono-send / stereo-return trick (the pedal's second output comes back on the sibling Ring).
    for node in sorted(n for n in nodes if is_loop(n) and n not in has_in and n in succ):
        n = loop_no(node)
        lp = topo.loop(n) if topo else None
        p = walk(node, f"Right (return of loop {n}, {specs.ML10X_LOOP_NAMES[n]})")
        if p.steps:
            first = p.steps[0]
            if lp and lp.return_from_instance_id:
                first.state = "return_only"
                first.device = lp.return_from_label
                first.device_instance_id = lp.return_from_instance_id
                first.note = f"return-only: nothing feeds this loop's Send; its Return carries the second output of {lp.return_from_label}"
                first.out_port_id = None
                first.cables = [c for c in (lp.return_connection_id,) if c]
                p.complete = bool(p.ends_at)
            else:
                first.state = "missing"
                first.device = None
                first.note = "used as a return-only loop but nothing is cabled into its Return"
                p.complete = False
            p.summary = _summary(p)
        paths.append(p)
    reached = {e for p in paths for e in p.ends_at}
    for out in OUTPUT_NODES:
        if out in nodes and out not in reached:
            diags.append(
                Diagnostic(
                    code="ml10x.output_unreachable",
                    severity=Severity.ERROR,
                    message=f"ML10X preset {preset.number} '{preset.name}': {_node_label(out)} is referenced but no complete path reaches it.",
                    subject_type="preset",
                    subject_id=subj,
                )
            )
    if preset.mode == "advanced" and edges and not any(p.ends_at for p in paths):
        diags.append(
            Diagnostic(
                code="ml10x.no_output",
                severity=Severity.ERROR,
                message=f"ML10X preset {preset.number} '{preset.name}' never reaches an Output; the signal would be lost.",
                subject_type="preset",
                subject_id=subj,
            )
        )
    stereo_out = "OUT_TIP" in reached and "OUT_RING" in reached
    return {
        "preset_number": preset.number,
        "preset_name": preset.name,
        "mode": preset.mode,
        "paths": [p.as_dict() for p in paths],
        "stereo_output": stereo_out,
        "stereo_input": "IN_TIP" in nodes and "IN_RING" in nodes,
        "diagnostics": diags,
    }


def _summary(path: ConductorPath) -> str:
    labels = []
    for s in path.steps:
        if s.node in INPUT_NODES or s.node in OUTPUT_NODES:
            labels.append(
                f"{s.device} → {s.label}"
                if s.device and s.node in INPUT_NODES
                else f"{s.label} → {s.device}"
                if s.device
                else s.label
            )
        elif s.device:
            labels.append(f"{s.device}{' (bypassed)' if s.state == 'bypassed' else ''}")
        elif is_loop(s.node):
            labels.append(f"{s.label} (empty)")
        else:
            labels.append(s.label)
    return " → ".join(labels)


def _follow(start: str, succ: dict[str, list[str]], seen: set[str]) -> list[str]:
    out: list[str] = []
    cur = start
    while cur in succ and succ[cur] and succ[cur][0] not in seen:
        cur = succ[cur][0]
        seen.add(cur)
        out.append(cur)
    return out


def advanced_cabling_diagnostics(topo: Ml10xTopology, preset: Ml10xPreset) -> list[Diagnostic]:
    """Direction-aware physical checks for Advanced edges.

    An edge X -> Ln drives the loop's Send, so Send n must be cabled; an edge Ln -> Y takes
    the loop's Return, so Return n must be cabled. A loop used only as a source is the
    documented mono-send/stereo-return pattern and needs only its Return.
    """
    diags: list[Diagnostic] = []
    subj = f"ml10x-preset-{preset.number}"
    needs_send: set[int] = set()
    needs_return: set[int] = set()
    for a, b in preset_edges(preset):
        if is_loop(b):
            needs_send.add(loop_no(b))
        if is_loop(a):
            needs_return.add(loop_no(a))
    for n in sorted(needs_send | needs_return):
        lp = topo.loop(n)
        if lp is None:
            continue
        if n in needs_send and not lp.send_to_instance_id:
            diags.append(
                Diagnostic(
                    code="ml10x.preset_loop_not_cabled",
                    severity=Severity.ERROR,
                    message=f"ML10X preset {preset.number} '{preset.name}' routes into loop {n} ({lp.name}) but Send {lp.name} is not cabled.",
                    subject_type="preset",
                    subject_id=subj,
                    related_ids=[topo.instance_id],
                )
            )
        if n in needs_return and not lp.return_from_instance_id:
            diags.append(
                Diagnostic(
                    code="ml10x.preset_loop_not_cabled",
                    severity=Severity.ERROR,
                    message=f"ML10X preset {preset.number} '{preset.name}' takes the Return of loop {n} ({lp.name}) but nothing is cabled into it.",
                    subject_type="preset",
                    subject_id=subj,
                    related_ids=[topo.instance_id],
                )
            )
        if n in needs_return and n not in needs_send and lp.return_from_instance_id:
            diags.append(
                Diagnostic(
                    code="ml10x.return_only_loop",
                    severity=Severity.INFO,
                    message=f"ML10X preset {preset.number}: loop {n} ({lp.name}) is used return-only (mono send / stereo return pattern) — its Return carries {lp.return_from_label}.",
                    subject_type="preset",
                    subject_id=subj,
                )
            )
    return diags
