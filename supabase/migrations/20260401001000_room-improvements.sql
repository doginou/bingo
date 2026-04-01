-- Améliorations :
-- 1) même pseudo => même joueur dans une room (cross-device)
-- 2) room terminée avec gagnant
-- 3) pool de tâches dur/facile pour préremplissage intelligent

alter table public.rooms
  drop constraint if exists rooms_status_check;

alter table public.rooms
  add constraint rooms_status_check
  check (status in ('setup', 'playing', 'finished'));

alter table public.rooms
  add column if not exists winner_player_id uuid references public.room_players (id) on delete set null,
  add column if not exists finished_at timestamptz;

alter table public.room_players
  add column if not exists normalized_name text;

update public.room_players
set normalized_name = lower(trim(display_name))
where normalized_name is null;

alter table public.room_players
  alter column normalized_name set not null;

create unique index if not exists room_players_room_id_normalized_name_key
  on public.room_players (room_id, normalized_name);

create table if not exists public.bingo_task_pool (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  label text not null,
  difficulty text not null check (difficulty in ('easy', 'hard')),
  created_at timestamptz not null default now()
);

create index if not exists bingo_task_pool_room_id_idx on public.bingo_task_pool (room_id);

alter table public.bingo_task_pool enable row level security;

drop policy if exists "bingo_task_pool_rw" on public.bingo_task_pool;
create policy "bingo_task_pool_rw" on public.bingo_task_pool for all using (true) with check (true);

alter publication supabase_realtime add table public.bingo_task_pool;
