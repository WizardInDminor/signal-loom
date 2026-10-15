"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { RigSummary } from "@/lib/types";
import { Button, ErrorBanner, Field, Panel, confirmDialog } from "@/components/ui/basics";

export default function RigLibraryPage() {
  const router = useRouter();
  const [rigs, setRigs] = useState<RigSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [fromDemo, setFromDemo] = useState(false);
  const [width, setWidth] = useState(600);
  const [depth, setDepth] = useState(300);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    api.rigs
      .list()
      .then((list) => {
        setRigs(list);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const rig = await api.rigs.create({ name: name.trim(), from_demo: fromDemo, board_width_mm: width, board_depth_mm: depth });
      router.push(`/rigs/${rig.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      const res = await api.rigs.importProject(text);
      if (res.warnings.length) window.alert(`Imported with warnings:\n${res.warnings.join("\n")}`);
      router.push(`/rigs/${res.rig.id}`);
    } catch (err) {
      setError(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const rename = async (r: RigSummary) => {
    const n = window.prompt("New rig name", r.name);
    if (!n || n === r.name) return;
    await api.rigs.rename(r.id, n);
    void refresh();
  };
  const duplicate = async (r: RigSummary) => {
    await api.rigs.duplicate(r.id);
    void refresh();
  };
  const remove = async (r: RigSummary) => {
    if (!confirmDialog(`Delete rig "${r.name}"? This removes its devices, cables and scenes. This cannot be undone.`)) return;
    await api.rigs.remove(r.id);
    void refresh();
  };

  return (
    <div className="p-6 max-w-5xl w-full mx-auto flex flex-col gap-4">
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <div className="grid md:grid-cols-[2fr_1fr] gap-4">
        <Panel title="Your rigs">
          {rigs === null && !error && <p className="text-sm text-neutral-500">Loading…</p>}
          {rigs?.length === 0 && (
            <p className="text-sm text-neutral-600">
              No rigs yet. Create one on the right, or tick <em>Start from the demo rig</em> to explore a complete three-scene example.
            </p>
          )}
          <ul className="divide-y divide-line">
            {rigs?.map((r) => (
              <li key={r.id} className="py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <Link href={`/rigs/${r.id}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  <div className="text-xs text-neutral-500">
                    {r.instance_count} devices · {r.scene_count} scenes · updated {new Date(r.updated_at).toLocaleString()}
                  </div>
                  {r.description && <div className="text-xs text-neutral-600 truncate">{r.description}</div>}
                </div>
                <Button onClick={() => router.push(`/rigs/${r.id}`)} variant="primary">Open</Button>
                <Button onClick={() => rename(r)}>Rename</Button>
                <Button onClick={() => duplicate(r)}>Duplicate</Button>
                <Button onClick={() => remove(r)} variant="danger">Delete</Button>
              </li>
            ))}
          </ul>
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title="New rig">
            <form onSubmit={create} className="flex flex-col gap-2">
              <Field label="Name">
                <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Sunday board" />
              </Field>
              <label className="text-xs flex items-center gap-2">
                <input type="checkbox" checked={fromDemo} onChange={(e) => setFromDemo(e.target.checked)} />
                Start from the demo rig (ML10X + MC8 + three scenes)
              </label>
              {!fromDemo && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Board width (mm)">
                    <input type="number" min={100} max={5000} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
                  </Field>
                  <Field label="Board depth (mm)">
                    <input type="number" min={100} max={5000} value={depth} onChange={(e) => setDepth(Number(e.target.value))} />
                  </Field>
                </div>
              )}
              <Button type="submit" variant="primary">Create rig</Button>
            </form>
          </Panel>
          <Panel title="Import a Signal Loom project">
            <p className="text-xs text-neutral-600 mb-2">A <code>.signal-loom.json</code> file exported from the Exports tab. Profiles embedded in the file are added to your library if missing.</p>
            <input ref={fileRef} type="file" accept="application/json,.json" aria-label="Project file" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          </Panel>
          <Panel title="Tour: the three-scene demo">
            <ol className="text-xs text-neutral-700 list-decimal pl-4 flex flex-col gap-1">
              <li>Open the demo rig. The <b>Board</b> tab shows the ML10X, pedals and MC8 at true scale; drag or rotate them.</li>
              <li>The <b>Wiring</b> tab lists every cable by signal type and flags problems; try deleting “Plumes → Return A”.</li>
              <li><b>Scenes</b> holds Clean intro / Heavy verse / Solo with the compiled MIDI plan beside each.</li>
              <li><b>Controllers</b> maps scenes to MC8 bank 1 switches A/B/C and defines ML10X presets.</li>
              <li><b>Exports</b> gives the wiring manifest, switch map, project file and the MC8 bank backup (fixture-validated only).</li>
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}
