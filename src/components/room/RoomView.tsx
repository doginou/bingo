"use client";

import { getSupabase } from "@/lib/supabase/client";
import {
  clearStoredPlayerId,
  getClientId,
  getStoredPlayerId,
  setStoredPlayerId,
} from "@/lib/client-id";
import { findNewBingoLines } from "@/lib/bingo-lines";
import confetti from "canvas-confetti";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Room = {
  id: string;
  code: string;
  status: "setup" | "playing";
  created_at: string;
};

type RoomPlayer = {
  id: string;
  room_id: string;
  client_id: string;
  display_name: string;
  joined_at: string;
};

type BingoTask = {
  id: string;
  room_id: string;
  label: string;
  cell_index: number;
};

type TaskCompletion = {
  task_id: string;
  player_id: string;
  room_id: string;
  done: boolean;
};

function initialCelebrated(): Set<string> {
  return new Set();
}

function fireBingoConfetti() {
  const defaults = { origin: { y: 0.65 }, zIndex: 9999 };
  function shoot(p: { particleCount: number; spread: number; startVelocity: number }) {
    confetti({ ...defaults, ...p });
  }
  shoot({ particleCount: 80, spread: 55, startVelocity: 45 });
  setTimeout(() => {
    shoot({ particleCount: 60, spread: 80, startVelocity: 35 });
  }, 120);
  setTimeout(() => {
    shoot({ particleCount: 40, spread: 100, startVelocity: 25 });
  }, 240);
}

export function RoomView({ code }: { code: string }) {
  const supabase = getSupabase();
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [tasks, setTasks] = useState<BingoTask[]>([]);
  const [completions, setCompletions] = useState<TaskCompletion[]>([]);
  const [meId, setMeId] = useState<string | null>(() =>
    typeof window !== "undefined" ? getStoredPlayerId(code) : null,
  );
  const [joinName, setJoinName] = useState("");
  const [loading, setLoading] = useState(() => Boolean(supabase));
  const [error, setError] = useState<string | null>(null);
  const [draftCell, setDraftCell] = useState<number | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const celebratedRef = useRef<Set<string>>(initialCelebrated());

  const me = useMemo(
    () => players.find((p) => p.id === meId) ?? null,
    [players, meId],
  );

  const fetchAll = useCallback(async () => {
    if (!supabase) return;
    const { data: roomRow, error: roomErr } = await supabase
      .from("rooms")
      .select("*")
      .eq("code", code)
      .maybeSingle();
    if (roomErr || !roomRow) {
      setError("Partie introuvable.");
      setRoom(null);
      return;
    }
    setRoom(roomRow as Room);
    const rid = roomRow.id as string;

    const [{ data: pl }, { data: tk }, { data: co }] = await Promise.all([
      supabase.from("room_players").select("*").eq("room_id", rid),
      supabase.from("bingo_tasks").select("*").eq("room_id", rid).order("cell_index"),
      supabase.from("task_completions").select("*").eq("room_id", rid),
    ]);
    const list = (pl ?? []) as RoomPlayer[];
    setPlayers(list);
    setTasks((tk ?? []) as BingoTask[]);
    setCompletions((co ?? []) as TaskCompletion[]);
    setError(null);
    const stored = getStoredPlayerId(code);
    if (stored && !list.some((p) => p.id === stored)) {
      clearStoredPlayerId(code);
      setMeId(null);
    }
  }, [supabase, code]);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      await fetchAll();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, fetchAll]);

  useEffect(() => {
    if (!supabase || !room) return;
    const rid = room.id;
    const channel = supabase
      .channel(`room:${rid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${rid}`,
        },
        () => {
          void fetchAll();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_players",
          filter: `room_id=eq.${rid}`,
        },
        () => {
          void fetchAll();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bingo_tasks",
          filter: `room_id=eq.${rid}`,
        },
        () => {
          void fetchAll();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_completions",
          filter: `room_id=eq.${rid}`,
        },
        () => {
          void fetchAll();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, room, fetchAll]);

  const tasksByCell = useMemo(() => {
    const m = new Map<number, BingoTask>();
    for (const t of tasks) m.set(t.cell_index, t);
    return m;
  }, [tasks]);

  const completionMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const c of completions) {
      m.set(`${c.task_id}:${c.player_id}`, c.done);
    }
    return m;
  }, [completions]);

  useEffect(() => {
    if (!room || room.status !== "playing" || !me) return;
    const doneCells = new Set<number>();
    for (const t of tasks) {
      if (completionMap.get(`${t.id}:${me.id}`)) doneCells.add(t.cell_index);
    }
    const newLines = findNewBingoLines(doneCells, tasksByCell, celebratedRef.current);
    if (newLines.length > 0) {
      for (const k of newLines) celebratedRef.current.add(k);
      fireBingoConfetti();
    }
  }, [room, me, tasks, tasksByCell, completionMap]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !room || !joinName.trim()) return;
    const clientId = getClientId();
    const { data, error: err } = await supabase
      .from("room_players")
      .upsert(
        {
          room_id: room.id,
          client_id: clientId,
          display_name: joinName.trim(),
        },
        { onConflict: "room_id,client_id" },
      )
      .select()
      .single();
    if (err) {
      setError(err.message);
      return;
    }
    const row = data as RoomPlayer;
    setStoredPlayerId(code, row.id);
    setMeId(row.id);
    await fetchAll();
  };

  const saveCell = async () => {
    if (!supabase || !room || draftCell === null) return;
    const label = draftLabel.trim();
    if (!label) return;
    const { error: err } = await supabase.from("bingo_tasks").upsert(
      {
        room_id: room.id,
        cell_index: draftCell,
        label,
      },
      { onConflict: "room_id,cell_index" },
    );
    if (err) setError(err.message);
    else {
      setDraftCell(null);
      setDraftLabel("");
      await fetchAll();
    }
  };

  const startGame = async () => {
    if (!supabase || !room || tasks.length !== 25) return;
    const { error: err } = await supabase
      .from("rooms")
      .update({ status: "playing" })
      .eq("id", room.id);
    if (err) setError(err.message);
    else await fetchAll();
  };

  const toggleDone = async (taskId: string, playerId: string) => {
    if (!supabase || !room || !me || playerId !== me.id) return;
    const key = `${taskId}:${playerId}`;
    const current = completionMap.get(key) ?? false;
    const { error: err } = await supabase.from("task_completions").upsert(
      {
        task_id: taskId,
        player_id: playerId,
        room_id: room.id,
        done: !current,
      },
      { onConflict: "task_id,player_id" },
    );
    if (err) setError(err.message);
  };

  if (!supabase) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-zinc-300">
          Configure <code className="text-emerald-400">NEXT_PUBLIC_SUPABASE_URL</code> et{" "}
          <code className="text-emerald-400">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> dans{" "}
          <code className="text-emerald-400">.env.local</code>.
        </p>
        <Link href="/" className="mt-6 inline-block text-emerald-400 underline">
          Retour
        </Link>
      </div>
    );
  }

  if (loading && !room) {
    return (
      <div className="flex flex-1 items-center justify-center py-24 text-zinc-500">
        Chargement…
      </div>
    );
  }

  if (error && !room) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-red-400">{error}</p>
        <Link href="/" className="mt-6 inline-block text-emerald-400 underline">
          Accueil
        </Link>
      </div>
    );
  }

  if (!room) return null;

  if (!meId || !me) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
        <h1 className="mb-2 font-mono text-sm text-zinc-500">Code · {room.code}</h1>
        <p className="mb-6 text-lg text-zinc-200">Entre ton prénom pour rejoindre la grille.</p>
        <form onSubmit={handleJoin} className="flex flex-col gap-4">
          <input
            value={joinName}
            onChange={(e) => setJoinName(e.target.value)}
            placeholder="Ton prénom"
            className="rounded-xl border border-zinc-700 bg-zinc-900/80 px-4 py-3 text-zinc-100 outline-none ring-emerald-500/30 placeholder:text-zinc-600 focus:ring-2"
            maxLength={32}
            autoFocus
          />
          <button
            type="submit"
            disabled={!joinName.trim()}
            className="rounded-xl bg-emerald-600 py-3 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-40"
          >
            Rejoindre
          </button>
        </form>
        {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}
      </div>
    );
  }

  const sortedPlayers = [...players].sort((a, b) =>
    a.joined_at.localeCompare(b.joined_at),
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-zinc-800 pb-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">Partie</p>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">{room.code}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Connecté en tant que <span className="text-emerald-400">{me.display_name}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              room.status === "playing"
                ? "bg-emerald-950 text-emerald-300"
                : "bg-amber-950 text-amber-200"
            }`}
          >
            {room.status === "playing" ? "En cours" : "Préparation"}
          </span>
          <Link
            href="/"
            className="text-sm text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
          >
            Accueil
          </Link>
        </div>
      </header>

      {error ? <p className="mb-4 text-sm text-red-400">{error}</p> : null}

      {room.status === "setup" && (
        <section className="mb-10">
          <h2 className="mb-2 text-lg font-medium text-zinc-200">Remplis les 25 cases</h2>
          <p className="mb-4 text-sm text-zinc-500">
            Clique une case pour éditer. Quand les 25 sont remplies, lance la partie — chacun
            coche ce qu&apos;il a fait, les autres voient les pastilles en direct.
          </p>
          <div className="grid grid-cols-5 gap-2 sm:gap-3">
            {Array.from({ length: 25 }, (_, i) => {
              const t = tasksByCell.get(i);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setDraftCell(i);
                    setDraftLabel(t?.label ?? "");
                  }}
                  className="flex min-h-[72px] flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/50 p-2 text-center transition hover:border-zinc-600 hover:bg-zinc-900"
                >
                  <span className="text-[10px] font-mono text-zinc-600">{i + 1}</span>
                  <span className="line-clamp-3 text-xs font-medium leading-tight text-zinc-200">
                    {t?.label ?? "＋"}
                  </span>
                </button>
              );
            })}
          </div>
          {draftCell !== null && (
            <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-zinc-500">Case {draftCell + 1}</label>
                <input
                  value={draftLabel}
                  onChange={(e) => setDraftLabel(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-500/40"
                  placeholder="Ex : Manger du renne"
                  autoFocus
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setDraftCell(null);
                  setDraftLabel("");
                }}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-900"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void saveCell()}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                Enregistrer
              </button>
            </div>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button
              type="button"
              disabled={tasks.length !== 25}
              onClick={() => void startGame()}
              className="rounded-xl bg-emerald-600 px-6 py-3 font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Lancer le bingo
            </button>
            <span className="text-sm text-zinc-500">
              {tasks.length}/25 cases · {sortedPlayers.length} joueur
              {sortedPlayers.length > 1 ? "s" : ""}
            </span>
          </div>
        </section>
      )}

      {room.status === "playing" && (
        <section>
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-zinc-500">
            <span>Légende :</span>
            {sortedPlayers.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1.5">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-bold ${
                    p.id === me.id
                      ? "border-emerald-500 bg-emerald-600/30 text-emerald-200"
                      : "border-zinc-600 bg-zinc-800 text-zinc-300"
                  }`}
                >
                  {initial(p.display_name)}
                </span>
                <span className="text-zinc-400">{p.display_name}</span>
                {p.id === me.id ? <span className="text-emerald-500">(toi)</span> : null}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-5 gap-2 sm:gap-3">
            {Array.from({ length: 25 }, (_, i) => {
              const t = tasksByCell.get(i);
              if (!t) {
                return (
                  <div
                    key={i}
                    className="min-h-[100px] rounded-xl border border-zinc-900 bg-zinc-950/50"
                  />
                );
              }
              return (
                <div
                  key={t.id}
                  className="flex min-h-[100px] flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 p-2 text-center"
                >
                  <span className="line-clamp-4 text-[11px] font-semibold leading-snug text-zinc-100">
                    {t.label}
                  </span>
                  <div className="mt-2 flex flex-wrap justify-center gap-1">
                    {sortedPlayers.map((p) => {
                      const done = completionMap.get(`${t.id}:${p.id}`) ?? false;
                      const isMe = p.id === me.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={!isMe}
                          title={isMe ? "Cocher pour toi" : p.display_name}
                          onClick={() => void toggleDone(t.id, p.id)}
                          className={`flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-bold transition ${
                            done
                              ? "border-emerald-500 bg-emerald-600 text-white"
                              : "border-zinc-600 bg-transparent text-zinc-500"
                          } ${isMe ? "cursor-pointer hover:opacity-90" : "cursor-default opacity-90"}`}
                        >
                          {initial(p.display_name)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function initial(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  return t.slice(0, 2).toUpperCase();
}
