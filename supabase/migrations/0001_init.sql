-- Esquema inicial: ejecuciones, tareas, mensajes y eventos de agentes, versiones de ficheros.
-- Ejecutar en Supabase → SQL Editor. Idempotente en lo posible.

create extension if not exists pgcrypto;

-- ── Ejecuciones (una por petición del usuario) ────────────────────────────────
create table if not exists public.runs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users (id) on delete set null,
  prompt          text not null check (char_length(prompt) between 3 and 500),
  status          text not null default 'queued'
                  check (status in ('queued','planning','running','integrating','done','done_with_failures','failed')),
  mode            text not null default 'live' check (mode in ('live','demo')),
  current_version int  not null default 0,
  step_count      int  not null default 0,
  error_count     int  not null default 0,
  locked_until    timestamptz not null default 'epoch',
  error           text,
  is_showcase     boolean not null default false,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz
);
create index if not exists runs_created_at_idx on public.runs (created_at desc);

-- ── Tareas que el Orquestador asigna a Develop ────────────────────────────────
create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.runs (id) on delete cascade,
  position     int  not null,
  title        text not null,
  description  text not null,
  files        jsonb not null default '[]'::jsonb,
  acceptance   jsonb not null default '[]'::jsonb,
  status       text not null default 'pending'
               check (status in ('pending','developing','testing','fixing','passed','failed')),
  attempts     int  not null default 0,
  max_attempts int  not null default 3,
  updated_at   timestamptz not null default now(),
  unique (run_id, position)
);

-- ── Mensajes entre agentes (asignación, entrega, informe, feedback, resumen) ──
create table if not exists public.agent_messages (
  id         bigint generated always as identity primary key,
  run_id     uuid not null references public.runs (id) on delete cascade,
  task_id    uuid references public.tasks (id) on delete cascade,
  from_agent text not null check (from_agent in ('orchestrator','develop','testing')),
  to_agent   text not null check (to_agent in ('orchestrator','develop','testing')),
  kind       text not null check (kind in ('assignment','delivery','test_report','feedback','summary')),
  body       jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists agent_messages_run_idx on public.agent_messages (run_id, id);

-- ── Registro de lo que hace cada agente ───────────────────────────────────────
create table if not exists public.agent_events (
  id         bigint generated always as identity primary key,
  run_id     uuid not null references public.runs (id) on delete cascade,
  task_id    uuid references public.tasks (id) on delete cascade,
  agent      text not null check (agent in ('orchestrator','develop','testing')),
  type       text not null check (type in ('state','llm_call','check','info','error')),
  message    text not null,
  data       jsonb,
  provider   text,
  model      text,
  latency_ms int,
  created_at timestamptz not null default now()
);
create index if not exists agent_events_run_idx on public.agent_events (run_id, id);

-- ── Instantáneas completas de la web demo por versión ─────────────────────────
create table if not exists public.file_versions (
  id         bigint generated always as identity primary key,
  run_id     uuid not null references public.runs (id) on delete cascade,
  version    int  not null,
  path       text not null check (path ~ '^[a-z0-9][a-z0-9_-]*(/[a-z0-9][a-z0-9_-]*)*\.(html|css|svg)$'),
  content    text not null,
  task_id    uuid references public.tasks (id) on delete set null,
  created_by text not null check (created_by in ('template','develop')),
  created_at timestamptz not null default now(),
  unique (run_id, version, path)
);

-- ── Informes de Testing por intento ───────────────────────────────────────────
create table if not exists public.test_reports (
  id            bigint generated always as identity primary key,
  task_id       uuid not null references public.tasks (id) on delete cascade,
  attempt       int  not null,
  deterministic jsonb not null,
  llm_review    jsonb,
  passed        boolean not null,
  failures      jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  unique (task_id, attempt)
);

-- ── Lease atómico: solo un paso del motor a la vez por ejecución ──────────────
create or replace function public.claim_run(p_run_id uuid, p_lease_seconds int default 150)
returns setof public.runs
language sql
security definer
set search_path = public
as $$
  update public.runs
     set locked_until = now() + make_interval(secs => p_lease_seconds)
   where id = p_run_id
     and locked_until < now()
     and status not in ('done','done_with_failures','failed')
  returning *;
$$;

create or replace function public.release_run(p_run_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.runs set locked_until = 'epoch' where id = p_run_id;
$$;

revoke execute on function public.claim_run(uuid, int) from public, anon, authenticated;
revoke execute on function public.release_run(uuid) from public, anon, authenticated;

-- ── RLS: lectura pública (datos no sensibles), escritura solo con service role ─
alter table public.runs           enable row level security;
alter table public.tasks          enable row level security;
alter table public.agent_messages enable row level security;
alter table public.agent_events   enable row level security;
alter table public.file_versions  enable row level security;
alter table public.test_reports   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['runs','tasks','agent_messages','agent_events','file_versions','test_reports'] loop
    execute format('drop policy if exists "lectura publica" on public.%I', t);
    execute format('create policy "lectura publica" on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- ── Realtime (Postgres Changes) para el tablero en directo ────────────────────
do $$
declare t text;
begin
  foreach t in array array['runs','tasks','agent_messages','agent_events'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
