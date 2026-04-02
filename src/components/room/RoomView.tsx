"use client";

import { getSupabase } from "@/lib/supabase/client";
import {
  clearStoredPlayerId,
  getStoredPlayerId,
  setStoredPlayerId,
} from "@/lib/client-id";
import { findNewBingoLines, hasAnyBingoLine } from "@/lib/bingo-lines";
import confetti from "canvas-confetti";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Room = {
  id: string;
  code: string;
  status: "setup" | "playing" | "finished";
  created_at: string;
  winner_player_id: string | null;
  finished_at: string | null;
};

type RoomPlayer = {
  id: string;
  room_id: string;
  client_id: string;
  display_name: string;
  joined_at: string;
  normalized_name: string;
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

type TaskPoolItem = {
  id: string;
  room_id: string;
  label: string;
  difficulty: "easy" | "hard";
  created_at: string;
};

const GRID_SIZE = 25;
/** Case centrale (ligne du milieu) : jamais préremplie — à choisir à la main (souvent l’ultra dur). */
const GRID_CENTER_INDEX = 12;
/** Diagonales en X sans le centre : 8 cases « difficiles ». */
const HARD_X_CELLS = [0, 4, 6, 8, 16, 18, 20, 24];
/** Quatre cases faciles, hors X et hors centre (milieux de bords). */
const EASY_WING_CELLS = [2, 10, 14, 22];

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
  const [pool, setPool] = useState<TaskPoolItem[]>([]);
  const [meId, setMeId] = useState<string | null>(() =>
    typeof window !== "undefined" ? getStoredPlayerId(code) : null,
  );
  const [joinName, setJoinName] = useState("");
  const [loading, setLoading] = useState(() => Boolean(supabase));
  const [error, setError] = useState<string | null>(null);
  const [draftCell, setDraftCell] = useState<number | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [poolLabel, setPoolLabel] = useState("");
  const [poolDifficulty, setPoolDifficulty] = useState<"easy" | "hard">("easy");
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

    const [{ data: pl }, { data: tk }, { data: co }, { data: po }] = await Promise.all([
      supabase.from("room_players").select("*").eq("room_id", rid),
      supabase.from("bingo_tasks").select("*").eq("room_id", rid).order("cell_index"),
      supabase.from("task_completions").select("*").eq("room_id", rid),
      supabase.from("bingo_task_pool").select("*").eq("room_id", rid).order("created_at"),
    ]);
    const list = (pl ?? []) as RoomPlayer[];
    setPlayers(list);
    setTasks((tk ?? []) as BingoTask[]);
    setCompletions((co ?? []) as TaskCompletion[]);
    setPool((po ?? []) as TaskPoolItem[]);
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
    const normalized = joinName.trim().toLowerCase();
    const { data, error: err } = await supabase
      .from("room_players")
      .upsert(
        {
          room_id: room.id,
          client_id: normalized,
          display_name: joinName.trim(),
          normalized_name: normalized,
        },
        { onConflict: "room_id,normalized_name" },
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
    if (!supabase || !room || tasks.length !== GRID_SIZE) return;
    const { error: err } = await supabase
      .from("rooms")
      .update({ status: "playing" })
      .eq("id", room.id);
    if (err) setError(err.message);
    else await fetchAll();
  };

  const finishIfWinner = useCallback(
    async (playerId: string) => {
      if (!supabase || !room) return;
      const doneCells = new Set<number>();
      for (const t of tasks) {
        if (completionMap.get(`${t.id}:${playerId}`)) doneCells.add(t.cell_index);
      }
      if (!hasAnyBingoLine(doneCells, tasksByCell)) return;
      const { error: err } = await supabase
        .from("rooms")
        .update({
          status: "finished",
          winner_player_id: playerId,
          finished_at: new Date().toISOString(),
        })
        .eq("id", room.id)
        .eq("status", "playing");
      if (err) setError(err.message);
    },
    [supabase, room, tasks, completionMap, tasksByCell],
  );

  const toggleDone = async (taskId: string, playerId: string) => {
    if (
      !supabase ||
      !room ||
      !me ||
      playerId !== me.id ||
      (room.status !== "playing" && room.status !== "finished")
    ) {
      return;
    }
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
    else {
      await fetchAll();
      await finishIfWinner(playerId);
    }
  };

  const addPoolItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !room) return;
    const label = poolLabel.trim();
    if (!label) return;
    const { error: err } = await supabase.from("bingo_task_pool").insert({
      room_id: room.id,
      label,
      difficulty: poolDifficulty,
    });
    if (err) setError(err.message);
    else {
      setPoolLabel("");
      await fetchAll();
    }
  };

  const removePoolItem = async (itemId: string) => {
    if (!supabase) return;
    const { error: err } = await supabase.from("bingo_task_pool").delete().eq("id", itemId);
    if (err) setError(err.message);
    else await fetchAll();
  };

  const autoFillFromPool = async () => {
    if (!supabase || !room) return;
    const hard = pool.filter((p) => p.difficulty === "hard");
    const easy = pool.filter((p) => p.difficulty === "easy");
    if (hard.length < HARD_X_CELLS.length || easy.length < EASY_WING_CELLS.length) {
      setError("Ajoute au moins 8 tâches dures et 4 faciles pour le préremplissage.");
      return;
    }
    const shuffle = <T,>(list: T[]): T[] => [...list].sort(() => Math.random() - 0.5);
    const hardPick = shuffle(hard).slice(0, HARD_X_CELLS.length);
    const easyPick = shuffle(easy).slice(0, EASY_WING_CELLS.length);

    const used = new Set([...hardPick.map((t) => t.id), ...easyPick.map((t) => t.id)]);
    const remaining = shuffle(pool.filter((p) => !used.has(p.id)));
    const middleCells = Array.from({ length: GRID_SIZE }, (_, i) => i).filter(
      (i) =>
        !HARD_X_CELLS.includes(i) &&
        !EASY_WING_CELLS.includes(i) &&
        i !== GRID_CENTER_INDEX,
    );
    const middlePick = remaining.slice(0, middleCells.length);

    if (middlePick.length < middleCells.length) {
      setError("Pas assez de tâches dans la pool pour remplir toute la grille.");
      return;
    }

    const inserts: { room_id: string; cell_index: number; label: string }[] = [];
    hardPick.forEach((item, idx) => {
      inserts.push({ room_id: room.id, cell_index: HARD_X_CELLS[idx]!, label: item.label });
    });
    easyPick.forEach((item, idx) => {
      inserts.push({ room_id: room.id, cell_index: EASY_WING_CELLS[idx]!, label: item.label });
    });
    middlePick.forEach((item, idx) => {
      inserts.push({ room_id: room.id, cell_index: middleCells[idx]!, label: item.label });
    });

    const { error: delErr } = await supabase.from("bingo_tasks").delete().eq("room_id", room.id);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    const { error: insErr } = await supabase.from("bingo_tasks").insert(inserts);
    if (insErr) setError(insErr.message);
    else await fetchAll();
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
                : room.status === "finished"
                  ? "bg-purple-950 text-purple-300"
                  : "bg-amber-950 text-amber-200"
            }`}
          >
            {room.status === "playing"
              ? "En cours"
              : room.status === "finished"
                ? "Terminé"
                : "Préparation"}
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

      {room.status === "finished" && (
        <div className="mb-6 rounded-xl border border-purple-700/40 bg-purple-950/30 p-4 text-sm text-purple-100">
          Partie terminée :{" "}
          <span className="font-semibold">
            {players.find((p) => p.id === room.winner_player_id)?.display_name ?? "Gagnant inconnu"}
          </span>{" "}
          a gagné.
        </div>
      )}

      {room.status === "setup" && (
        <section className="mb-10">
          <h2 className="mb-2 text-lg font-medium text-zinc-200">
            Prépare la grille et la pool de tâches
          </h2>
          <p className="mb-4 text-sm text-zinc-500">
            Tu peux ajouter plus de 25 tâches. Le préremplissage place les dures en{" "}
            <strong className="font-medium text-zinc-400">X</strong> (diagonales, sans le milieu), les
            faciles sur les bords, et laisse la case du centre pour toi — en général la seule ligne où
            un bingo peut passer avec une seule case difficile, donc mets-y le défi le plus cruel.
          </p>
          <form onSubmit={addPoolItem} className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
            <input
              value={poolLabel}
              onChange={(e) => setPoolLabel(e.target.value)}
              placeholder="Nouvelle tâche dans la pool"
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
            <select
              value={poolDifficulty}
              onChange={(e) => setPoolDifficulty(e.target.value as "easy" | "hard")}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none"
            >
              <option value="easy">Facile</option>
              <option value="hard">Difficile</option>
            </select>
            <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white">
              Ajouter
            </button>
          </form>
          <div className="mb-5 flex flex-wrap gap-2">
            {pool.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void removePoolItem(item.id)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  item.difficulty === "hard"
                    ? "border-rose-700/50 bg-rose-950/30 text-rose-200"
                    : "border-cyan-700/50 bg-cyan-950/30 text-cyan-200"
                }`}
                title="Supprimer"
              >
                {item.label} ×
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void autoFillFromPool()}
            className="mb-5 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
          >
            Préremplir (X difficile + bords faciles, centre libre)
          </button>
          <div className="grid grid-cols-5 gap-2 sm:gap-3">
            {Array.from({ length: GRID_SIZE }, (_, i) => {
              const t = tasksByCell.get(i);
              const isCenter = i === GRID_CENTER_INDEX;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setDraftCell(i);
                    setDraftLabel(t?.label ?? "");
                  }}
                  className={`flex min-h-[72px] flex-col items-center justify-center rounded-xl border bg-zinc-900/50 p-2 text-center transition hover:bg-zinc-900 ${
                    isCenter
                      ? "border-amber-700/40 ring-1 ring-amber-500/25 hover:border-amber-600/50"
                      : "border-zinc-800 hover:border-zinc-600"
                  }`}
                >
                  <span className="text-[10px] font-mono text-zinc-600">
                    {isCenter ? "★" : i + 1}
                  </span>
                  <span className="line-clamp-3 text-xs font-medium leading-tight text-zinc-200">
                    {t?.label ?? (isCenter ? "Centre (à toi)" : "＋")}
                  </span>
                </button>
              );
            })}
          </div>
          {draftCell !== null && (
            <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-zinc-500">
                  Case {draftCell + 1}
                  {draftCell === GRID_CENTER_INDEX ? (
                    <span className="ml-2 text-amber-600/90">· centre — souvent l’ultra dur</span>
                  ) : null}
                </label>
                <input
                  value={draftLabel}
                  onChange={(e) => setDraftLabel(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-500/40"
                  placeholder={
                    draftCell === GRID_CENTER_INDEX
                      ? "Ex : Boss final — le truc quasi impossible"
                      : "Ex : Manger du renne"
                  }
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
              disabled={tasks.length !== GRID_SIZE}
              onClick={() => void startGame()}
              className="rounded-xl bg-emerald-600 px-6 py-3 font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Lancer le bingo
            </button>
            <span className="text-sm text-zinc-500">
              {tasks.length}/{GRID_SIZE} cases · pool {pool.length} tâches · {sortedPlayers.length} joueur
              {sortedPlayers.length > 1 ? "s" : ""}
            </span>
          </div>
        </section>
      )}

      {(room.status === "playing" || room.status === "finished") && (
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
            {Array.from({ length: GRID_SIZE }, (_, i) => {
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
                          disabled={!isMe || room.status === "setup"}
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
