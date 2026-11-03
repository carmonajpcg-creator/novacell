-- Fase 5 (2/2): cobranza. Reglas PROPUESTAS y pendientes de aprobación: docs/PENDING_RULES.md (B1..B6).
-- El envío es SIEMPRE manual. El sistema solo registra que se preparó un mensaje, que el administrador abrió
-- WhatsApp y el seguimiento declarado por el administrador. NO existe un estado "enviado" ni "entregado":
-- abrir WhatsApp no demuestra que el mensaje se haya enviado (CLAUDE.md §12).

create table public.collection_reminders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  installment_id uuid references public.installments (id) on delete restrict,
  layaway_id uuid references public.layaways (id) on delete restrict,
  kind text not null check (kind in ('upcoming', 'overdue', 'manual')),
  channel text not null default 'whatsapp' check (channel in ('whatsapp')),
  message text not null check (length(trim(message)) between 1 and 1000),
  status text not null default 'prepared' check (status in ('prepared', 'whatsapp_opened', 'contacted')),
  whatsapp_opened_at timestamptz,
  contacted_at timestamptz,
  outcome text check (outcome in ('no_answer', 'promise_to_pay', 'paid', 'refused', 'other')),
  promised_date date,
  note text check (note is null or length(note) <= 1000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(installment_id, layaway_id) <= 1),
  check (status = 'contacted' or (outcome is null and promised_date is null)),
  check (status <> 'contacted' or outcome is not null),
  check (promised_date is null or outcome = 'promise_to_pay')
);
create index collection_reminders_customer_idx on public.collection_reminders (customer_id, created_at desc);
create index collection_reminders_installment_idx on public.collection_reminders (installment_id, created_at desc);
create index collection_reminders_layaway_idx on public.collection_reminders (layaway_id, created_at desc);
create trigger collection_reminders_set_updated_at before update on public.collection_reminders
  for each row execute function public.set_updated_at();

-- Integridad y progresión de estados: el cliente del recordatorio debe ser el de la cuota/apartado,
-- las marcas de tiempo las pone el servidor y el estado solo avanza (prepared -> whatsapp_opened -> contacted).
create or replace function public.collection_reminders_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  owner uuid;
begin
  if tg_op = 'INSERT' then
    if new.installment_id is not null then
      select c.customer_id into owner from public.installments i join public.credits c on c.id = i.credit_id
      where i.id = new.installment_id;
    elsif new.layaway_id is not null then
      select customer_id into owner from public.layaways where id = new.layaway_id;
    else
      owner := new.customer_id;
    end if;
    if owner is distinct from new.customer_id then
      raise exception 'El cliente del recordatorio no corresponde a la cuota o apartado' using errcode = '23514';
    end if;
    if new.status <> 'prepared' or new.whatsapp_opened_at is not null or new.contacted_at is not null then
      raise exception 'Un recordatorio nuevo siempre inicia como preparado' using errcode = '23514';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.customer_id <> old.customer_id or new.installment_id is distinct from old.installment_id
     or new.layaway_id is distinct from old.layaway_id or new.kind <> old.kind or new.channel <> old.channel then
    raise exception 'Los datos de origen de un recordatorio no se modifican' using errcode = '42501';
  end if;
  if new.message <> old.message and old.status <> 'prepared' then
    raise exception 'El mensaje no se modifica después de abrir WhatsApp' using errcode = '23514';
  end if;
  if (old.status = 'contacted' and new.status <> 'contacted')
     or (old.status = 'whatsapp_opened' and new.status = 'prepared') then
    raise exception 'El estado de un recordatorio solo avanza' using errcode = '23514';
  end if;
  if new.status = 'whatsapp_opened' and old.status = 'prepared' then
    new.whatsapp_opened_at := now();
  end if;
  if new.status = 'contacted' and old.status <> 'contacted' then
    new.contacted_at := now();
    if new.whatsapp_opened_at is null then
      new.whatsapp_opened_at := old.whatsapp_opened_at;
    end if;
  end if;
  if new.status = old.status then
    new.whatsapp_opened_at := old.whatsapp_opened_at;
    new.contacted_at := old.contacted_at;
  end if;
  return new;
end;
$$;
revoke execute on function public.collection_reminders_guard() from public, anon, authenticated;
create trigger collection_reminders_guard_trg before insert or update on public.collection_reminders
  for each row execute function public.collection_reminders_guard();

-- Cola de cobranza: cuotas de créditos activos con saldo y apartados vigentes con saldo.
-- days_overdue > 0: vencido; <= 0: faltan -days_overdue días.
create view public.collection_queue with (security_invoker = true) as
select
  q.*,
  lr.status as last_reminder_status,
  lr.created_at as last_reminder_at,
  lr.outcome as last_outcome,
  lr.promised_date as last_promised_date
from (
  select
    'installment'::text as kind,
    st.id as ref_id,
    c.id as credit_id,
    null::uuid as layaway_id,
    c.customer_id,
    cu.name as customer_name,
    cu.phone as customer_phone,
    c.credit_number as folio,
    st.number as installment_number,
    st.due_date,
    st.remaining as amount_due,
    ((now() at time zone 'America/Mexico_City')::date - st.due_date) as days_overdue
  from public.installment_status st
  join public.credits c on c.id = st.credit_id and c.status = 'active'
  join public.customers cu on cu.id = c.customer_id
  where st.remaining > 0
  union all
  select
    'layaway'::text,
    ls.id,
    null::uuid,
    ls.id,
    ls.customer_id,
    ls.customer_name,
    ls.customer_phone,
    ls.layaway_number,
    null::integer,
    ls.due_date,
    ls.balance,
    ((now() at time zone 'America/Mexico_City')::date - ls.due_date)
  from public.layaway_summaries ls
  where ls.status in ('pending_down', 'active') and ls.balance > 0
) q
left join lateral (
  select r.status, r.created_at, r.outcome, r.promised_date
  from public.collection_reminders r
  where (q.kind = 'installment' and r.installment_id = q.ref_id)
     or (q.kind = 'layaway' and r.layaway_id = q.ref_id)
  order by r.created_at desc
  limit 1
) lr on true;

-- Privilegios y RLS: solo el administrador; sin DELETE (el seguimiento es un historial).
revoke all on public.collection_reminders, public.collection_queue from anon, authenticated;
grant select on public.collection_reminders, public.collection_queue to authenticated;
grant insert (customer_id, installment_id, layaway_id, kind, message, note) on public.collection_reminders to authenticated;
grant update (message, status, outcome, promised_date, note) on public.collection_reminders to authenticated;

alter table public.collection_reminders enable row level security;
create policy collection_reminders_admin_select on public.collection_reminders for select to authenticated
  using ((select public.is_admin()));
create policy collection_reminders_admin_insert on public.collection_reminders for insert to authenticated
  with check ((select public.is_admin()));
create policy collection_reminders_admin_update on public.collection_reminders for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
