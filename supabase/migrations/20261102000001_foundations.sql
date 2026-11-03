-- Fase 1: fundamentos. Perfiles, configuración del negocio y auditoría.
-- RLS activa y acceso denegado por defecto.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: un perfil por usuario de auth. El rol NO es modificable desde el cliente.
-- El administrador se crea mediante el proceso controlado de docs/ADMIN_SETUP.md.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'employee' check (role in ('admin', 'employee')),
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- is_admin() se usa en las políticas. security definer evita recursión de RLS.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- business_settings: pares clave/valor. Solo las marcadas como públicas son visibles al visitante.
-- ---------------------------------------------------------------------------
create table public.business_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (length(key) between 1 and 100),
  value jsonb not null default 'null'::jsonb,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger business_settings_set_updated_at
  before update on public.business_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- audit_logs: bitácora de solo inserción.
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (length(action) between 1 and 100),
  entity text not null check (length(entity) between 1 and 100),
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs (entity, entity_id);
create index audit_logs_created_at_idx on public.audit_logs (created_at desc);

-- ---------------------------------------------------------------------------
-- Privilegios: se retira todo y se concede lo mínimo.
-- ---------------------------------------------------------------------------
revoke all on public.profiles, public.business_settings, public.audit_logs from anon, authenticated;

grant select on public.profiles to authenticated;                       -- sin insert/update/delete
grant select on public.business_settings to anon, authenticated;
grant insert, update, delete on public.business_settings to authenticated;
grant select, insert on public.audit_logs to authenticated;             -- append-only

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.business_settings enable row level security;
alter table public.audit_logs enable row level security;

-- profiles: cada usuario lee su propio perfil; el administrador lee todos.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
-- No hay políticas de insert/update/delete: nadie puede auto-asignarse privilegios.

-- business_settings
create policy settings_select_public on public.business_settings
  for select to anon, authenticated
  using (is_public);
create policy settings_admin_select on public.business_settings
  for select to authenticated
  using ((select public.is_admin()));
create policy settings_admin_insert on public.business_settings
  for insert to authenticated
  with check ((select public.is_admin()));
create policy settings_admin_update on public.business_settings
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy settings_admin_delete on public.business_settings
  for delete to authenticated
  using ((select public.is_admin()));

-- audit_logs: el administrador lee e inserta registros propios. Sin update ni delete.
create policy audit_admin_select on public.audit_logs
  for select to authenticated
  using ((select public.is_admin()));
create policy audit_admin_insert on public.audit_logs
  for insert to authenticated
  with check ((select public.is_admin()) and actor_id = (select auth.uid()));
