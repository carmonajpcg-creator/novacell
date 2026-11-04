-- MFA (TOTP) para el administrador.
-- La exigencia es un interruptor en business_settings ('require_mfa'). Mientras esté apagado el sistema funciona como antes;
-- cuando se enciende, is_admin() exige una sesión con segundo factor (aal2). El interruptor NO se puede cambiar con un
-- UPDATE directo: solo con set_require_mfa(), que exige estar ya en aal2 y tener un factor verificado (así nadie se deja fuera).

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
  )
  and (
    coalesce((select s.value = 'true'::jsonb from public.business_settings s where s.key = 'require_mfa'), false) is not true
    or coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
  );
$$;

create or replace function public.guard_require_mfa_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('novacell.mfa_flag', true), '') <> 'on'
     and (coalesce(old.key, '') = 'require_mfa' or coalesce(new.key, '') = 'require_mfa') then
    raise exception 'require_mfa solo se cambia con set_require_mfa()' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.guard_require_mfa_flag() from public, anon, authenticated;

drop trigger if exists business_settings_guard_mfa on public.business_settings;
create trigger business_settings_guard_mfa before insert or update or delete on public.business_settings
  for each row execute function public.guard_require_mfa_flag();

create or replace function public.set_require_mfa(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  if p_enabled is null then
    raise exception 'Valor inválido' using errcode = '22023';
  end if;
  -- Para encender o apagar hay que haber pasado el segundo factor en esta sesión.
  if coalesce((select auth.jwt()) ->> 'aal', '') <> 'aal2' then
    raise exception 'Confirma tu segundo factor (código de la app) para cambiar esta opción' using errcode = '42501';
  end if;
  if p_enabled and not exists (
    select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified'
  ) then
    raise exception 'Registra y verifica primero un factor (app de autenticación)' using errcode = '23514';
  end if;

  perform set_config('novacell.mfa_flag', 'on', true);
  insert into public.business_settings (key, value, is_public)
  values ('require_mfa', to_jsonb(p_enabled), false)
  on conflict (key) do update set value = excluded.value;

  insert into public.audit_logs (actor_id, action, entity, details)
  values (auth.uid(), 'set_require_mfa', 'business_settings', jsonb_build_object('enabled', p_enabled));
  return p_enabled;
end;
$$;

-- Lectura del estado para la interfaz (sin exponer nada más).
create or replace function public.mfa_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare required boolean;
begin
  if (select auth.uid()) is null or not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select coalesce((select s.value = 'true'::jsonb from public.business_settings s where s.key = 'require_mfa'), false) into required;
  return jsonb_build_object('required', required, 'aal', coalesce((select auth.jwt()) ->> 'aal', 'aal1'));
end;
$$;

revoke all on function public.set_require_mfa(boolean) from public, anon;
revoke all on function public.mfa_status() from public, anon;
grant execute on function public.set_require_mfa(boolean) to authenticated;
grant execute on function public.mfa_status() to authenticated;
