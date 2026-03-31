"use client";

import { getSupabase } from "@/lib/supabase/client";
import { createUniqueRoomCode } from "@/lib/room-code";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Home() {
  const router = useRouter();
  const supabase = getSupabase();
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createRoom = async () => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    try {
      const code = await createUniqueRoomCode(supabase);
      const { error: err } = await supabase.from("rooms").insert({ code });
      if (err) throw err;
      router.push(`/room/${code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const c = joinCode.replace(/\s/g, "").toUpperCase();
    if (c.length < 4) {
      setError("Code trop court.");
      return;
    }
    router.push(`/room/${c}`);
  };

  if (!supabase) {
    return (
      <main className="mx-auto flex max-w-lg flex-1 flex-col justify-center px-6 py-20">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">Bingo entre potes</h1>
        <p className="mt-3 text-zinc-400">
          Ajoute les variables{" "}
          <code className="text-emerald-400/90">NEXT_PUBLIC_SUPABASE_URL</code> et{" "}
          <code className="text-emerald-400/90">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> dans{" "}
          <code className="text-emerald-400/90">.env.local</code>, puis relance{" "}
          <code className="text-zinc-500">npm run dev</code>.
        </p>
        <p className="mt-4 text-sm text-zinc-600">
          Copie <code className="text-zinc-500">.env.local.example</code> et exécute le SQL dans{" "}
          <code className="text-zinc-500">supabase/migrations/</code> dans l&apos;éditeur SQL
          Supabase.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-lg flex-1 flex-col justify-center px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-500/80">Scandinave</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight text-zinc-50">Bingo</h1>
      <p className="mt-4 text-lg leading-relaxed text-zinc-400">
        Une grille par personne, les mêmes cases pour tout le monde — tu coches ce que{" "}
        <em className="text-zinc-300 not-italic">toi</em> tu as fait, et tu vois les pastilles des
        autres en direct.
      </p>

      <div className="mt-10 flex flex-col gap-6">
        <button
          type="button"
          disabled={busy}
          onClick={() => void createRoom()}
          className="rounded-2xl bg-emerald-600 px-6 py-4 text-center text-base font-medium text-white shadow-lg shadow-emerald-950/40 transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? "Création…" : "Créer une partie"}
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center" aria-hidden>
            <div className="w-full border-t border-zinc-800" />
          </div>
          <div className="relative flex justify-center text-xs uppercase tracking-widest">
            <span className="bg-zinc-950 px-3 text-zinc-600">ou</span>
          </div>
        </div>

        <form onSubmit={joinRoom} className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="Code (ex : K7P2M9)"
            className="min-h-14 flex-1 rounded-2xl border border-zinc-800 bg-zinc-900/80 px-4 font-mono text-lg tracking-widest text-zinc-100 outline-none ring-emerald-500/20 placeholder:text-zinc-600 focus:ring-2"
            maxLength={8}
          />
          <button
            type="submit"
            className="rounded-2xl border border-zinc-700 px-6 py-4 font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-900"
          >
            Rejoindre
          </button>
        </form>
      </div>

      {error ? <p className="mt-6 text-sm text-red-400">{error}</p> : null}

      <p className="mt-12 text-center text-xs text-zinc-600">
        Stack : Next.js · Tailwind · Supabase Realtime ·{" "}
        <span className="text-zinc-500">confetti</span>
      </p>
      <p className="mt-2 text-center text-xs text-zinc-700">
        <Link href="https://vercel.com" className="underline-offset-4 hover:text-zinc-500 hover:underline">
          Déployer sur Vercel
        </Link>
      </p>
    </main>
  );
}
