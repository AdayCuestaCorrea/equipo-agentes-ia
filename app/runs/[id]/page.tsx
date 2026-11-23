import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { RunView } from "@/components/run/run-view";
import { loadSnapshot } from "@/lib/runs/snapshot";
import { publicClient } from "@/lib/supabase/public";

export const metadata = { title: "Ejecución · Equipo de agentes" };

async function RunLoader({ params }: { params: PageProps<"/runs/[id]">["params"] }) {
  const { id } = await params;
  await connection();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const snapshot = await loadSnapshot(publicClient(), id);
  if (!snapshot) notFound();
  return <RunView initial={snapshot} />;
}

function RunSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy>
      <div className="h-10 w-2/3 rounded-lg bg-zinc-200" />
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-56 rounded-xl bg-zinc-200" />
        ))}
      </div>
      <div className="h-40 rounded-xl bg-zinc-200" />
    </div>
  );
}

export default function RunPage({ params }: PageProps<"/runs/[id]">) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <Link href="/" className="mb-4 inline-block text-sm text-zinc-500 hover:text-zinc-900">
        ← Volver
      </Link>
      <Suspense fallback={<RunSkeleton />}>
        <RunLoader params={params} />
      </Suspense>
    </main>
  );
}
