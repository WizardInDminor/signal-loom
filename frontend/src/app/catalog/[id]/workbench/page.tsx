"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import type { DeviceProfile } from "@/lib/types";
import { ErrorBanner } from "@/components/ui/basics";
import { Workbench } from "@/components/workbench/Workbench";

/** `/catalog/<profile id>/workbench?doc=<id>&page=<n>`: the MIDI Knowledge Workbench for one pedal profile. */
export default function WorkbenchPage() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    api.catalog.get(id).then(setProfile).catch((e) => setError(e.message));
  }, [id]);
  if (error) return <div className="p-6 flex flex-col gap-2"><ErrorBanner message={error} /><Link href="/catalog" className="text-sm underline">Back to the Device library</Link></div>;
  if (!profile) return <p className="p-6 text-sm text-neutral-500">Loading pedal…</p>;
  return <Workbench key={profile.id} initial={profile} />;
}
