-- Bingo multi-joueurs : exécuter dans le SQL Editor Supabase ou via CLI

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  status text not null default 'setup' check (status in ('setup', 'playing')),
  created_at timestamptz not null default now()
);

create table if not exists public.room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  client_id text not null,
  display_name text not null,
  joined_at timestamptz not null default now(),
  unique (room_id, client_id)
);

create index if not exists room_players_room_id_idx on public.room_players (room_id);

create table if not exists public.bingo_tasks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  label text not null,
  cell_index int not null check (cell_index >= 0 and cell_index < 25),
  unique (room_id, cell_index)
);

create index if not exists bingo_tasks_room_id_idx on public.bingo_tasks (room_id);

create table if not exists public.task_completions (
  task_id uuid not null references public.bingo_tasks (id) on delete cascade,
  player_id uuid not null references public.room_players (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  done boolean not null default false,
  primary key (task_id, player_id)
);

create index if not exists task_completions_room_id_idx on public.task_completions (room_id);

alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.bingo_tasks enable row level security;
alter table public.task_completions enable row level security;

-- Projet entre amis : accès public via clé anon (à durcir pour prod)
create policy "rooms_rw" on public.rooms for all using (true) with check (true);
create policy "room_players_rw" on public.room_players for all using (true) with check (true);
create policy "bingo_tasks_rw" on public.bingo_tasks for all using (true) with check (true);
create policy "task_completions_rw" on public.task_completions for all using (true) with check (true);

alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.room_players;
alter publication supabase_realtime add table public.bingo_tasks;
alter publication supabase_realtime add table public.task_completions;
