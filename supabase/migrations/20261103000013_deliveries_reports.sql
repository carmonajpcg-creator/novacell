-- Fase 7: entregas y reportes. Reglas PROPUESTAS y pendientes de aprobación: docs/PENDING_RULES.md (D1..D8 y R1..R8).
-- No se asumen tarifas ni zonas de cobertura (CLAUDE.md §13, §21): el costo de entrega lo captura el administrador
-- y se registra aparte (no se suma a la venta, a los pagos ni a la utilidad).
-- Las métricas y reportes se calculan en la base de datos (CLAUDE.md §3.10), en hora de Ciudad de México, y
-- distinguen siempre: venta registrada / dinero cobrado / utilidad estimada (CLAUDE.md §14).

-- ---------------------------------------------------------------------------
-- deliveries (datos personales: dirección. Solo administrador)
-- ---------------------------------------------------------------------------
create sequence public.delivery_number_seq;

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_number text not null unique
    default ('E-' || lpad(nextval('public.delivery_number_seq')::text, 6, '0')),
  sale_id uuid not null references public.sales (id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'preparing', 'on_the_way', 'delivered', 'cancelled')),
  address text not null check (length(trim(address)) between 5 and 500),
  reference_notes text check (reference_notes is null or length(reference_notes) <= 500),
  delivery_cost numeric(14, 2) not null default 0 check (delivery_cost >= 0 and delivery_cost <> 'NaN'::numeric),
  scheduled_date date,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  notes text check (notes is null or length(notes) <= 1000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'delivered') = (delivered_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check (status <> 'cancelled' or length(trim(coalesce(cancel_reason, ''))) > 0)
);
-- Una sola entrega vigente (no cancelada) por venta.
create unique index deliveries_one_active_per_sale on public.deliveries (sale_id) where status <> 'cancelled';
create index deliveries_status_idx on public.deliveries (status, scheduled_date);
create trigger deliveries_set_updated_at before update on public.deliveries
  for each row execute function public.set_updated_at();

-- Una entrega entregada o cancelada es historial: sus datos ya no se editan.
create or replace function public.deliveries_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('delivered', 'cancelled') and (
       new.address is distinct from old.address or new.reference_notes is distinct from old.reference_notes
       or new.delivery_cost is distinct from old.delivery_cost or new.scheduled_date is distinct from old.scheduled_date
       or new.notes is distinct from old.notes) then
    raise exception 'Una entrega % ya no se puede editar', old.status using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.deliveries_guard() from public, anon, authenticated;
create trigger deliveries_guard_trg before update on public.deliveries
  for each row execute function public.deliveries_guard();

create view public.delivery_summaries with (security_invoker = true) as
select
  d.id, d.delivery_number, d.sale_id, s.sale_number, s.modality, s.total as sale_total,
  c.id as customer_id, c.name as customer_name, c.phone as customer_phone,
  d.status, d.address, d.reference_notes, d.delivery_cost, d.scheduled_date, d.delivered_at,
  d.cancelled_at, d.cancel_reason, d.notes, d.created_at
from public.deliveries d
join public.sales s on s.id = d.sale_id
join public.customers c on c.id = s.customer_id;

-- ---------------------------------------------------------------------------
-- RPC: crear una entrega (solo para ventas confirmadas)
-- ---------------------------------------------------------------------------
create or replace function public.create_delivery(
  p_sale_id uuid,
  p_address text,
  p_reference_notes text,
  p_cost numeric,
  p_scheduled_date date,
  p_notes text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing record;
  s_status text;
  new_id uuid;
  v_cost numeric(14, 2);
  today date := (now() at time zone 'America/Mexico_City')::date;
begin
  perform public.assert_admin();

  if p_address is null or length(trim(p_address)) < 5 or length(trim(p_address)) > 500 then
    raise exception 'La dirección es obligatoria (5 a 500 caracteres)' using errcode = '22023';
  end if;
  v_cost := coalesce(p_cost, 0);
  if v_cost = 'NaN'::numeric or v_cost < 0 or v_cost <> round(v_cost, 2) then
    raise exception 'Costo de entrega inválido' using errcode = '22023';
  end if;
  if p_scheduled_date is not null and (p_scheduled_date < today or p_scheduled_date > today + 365) then
    raise exception 'La fecha programada debe estar entre hoy y un año' using errcode = '22023';
  end if;

  select * into existing from public.deliveries where idempotency_key = p_idempotency_key;
  if found then
    if existing.sale_id <> p_sale_id or existing.address <> trim(p_address) then
      raise exception 'La clave de idempotencia ya se usó con otros datos' using errcode = '23505';
    end if;
    return existing.id;
  end if;

  select status into s_status from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venta no encontrada' using errcode = 'P0002';
  end if;
  if s_status <> 'confirmed' then
    raise exception 'Solo se programan entregas de ventas confirmadas (estado: %)', s_status using errcode = '23514';
  end if;

  -- Con la venta bloqueada, un reintento simultáneo pudo haber creado ya esta entrega.
  select * into existing from public.deliveries where idempotency_key = p_idempotency_key;
  if found then
    if existing.sale_id <> p_sale_id or existing.address <> trim(p_address) then
      raise exception 'La clave de idempotencia ya se usó con otros datos' using errcode = '23505';
    end if;
    return existing.id;
  end if;
  if exists (select 1 from public.deliveries where sale_id = p_sale_id and status <> 'cancelled') then
    raise exception 'La venta ya tiene una entrega vigente' using errcode = '23505';
  end if;

  insert into public.deliveries (sale_id, address, reference_notes, delivery_cost, scheduled_date, notes, idempotency_key)
  values (p_sale_id, trim(p_address), nullif(trim(p_reference_notes), ''), v_cost, p_scheduled_date,
          nullif(trim(p_notes), ''), p_idempotency_key)
  returning id into new_id;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'create_delivery', 'deliveries', new_id,
    jsonb_build_object('sale_id', p_sale_id, 'delivery_cost', v_cost, 'scheduled_date', p_scheduled_date));
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: cambiar el estado. Solo avanza (pendiente < en preparación < en camino < entregada);
-- cancelar es posible desde cualquier estado no terminal y exige motivo. Idempotente.
-- ---------------------------------------------------------------------------
create or replace function public.set_delivery_status(p_delivery_id uuid, p_status text, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
  order_of constant text[] := array['pending', 'preparing', 'on_the_way', 'delivered'];
begin
  perform public.assert_admin();

  if p_status not in ('pending', 'preparing', 'on_the_way', 'delivered', 'cancelled') then
    raise exception 'Estado inválido' using errcode = '22023';
  end if;

  select * into d from public.deliveries where id = p_delivery_id for update;
  if not found then
    raise exception 'Entrega no encontrada' using errcode = 'P0002';
  end if;
  if d.status = p_status then
    return d.status;
  end if;
  if d.status in ('delivered', 'cancelled') then
    raise exception 'Una entrega % ya no cambia de estado', d.status using errcode = '23514';
  end if;

  if p_status = 'cancelled' then
    if length(trim(coalesce(p_reason, ''))) = 0 then
      raise exception 'El motivo de la cancelación es obligatorio' using errcode = '22023';
    end if;
    update public.deliveries set status = 'cancelled', cancelled_at = now(), cancel_reason = trim(p_reason)
    where id = p_delivery_id;
  else
    if array_position(order_of, p_status) <= array_position(order_of, d.status) then
      raise exception 'Una entrega no retrocede de % a %', d.status, p_status using errcode = '23514';
    end if;
    update public.deliveries
    set status = p_status, delivered_at = case when p_status = 'delivered' then now() end
    where id = p_delivery_id;
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'set_delivery_status', 'deliveries', p_delivery_id,
    jsonb_build_object('from', d.status, 'to', p_status, 'reason', nullif(trim(coalesce(p_reason, '')), '')));
  return p_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Métricas del dashboard (R1..R7). Todo en hora de Ciudad de México.
--   venta registrada  = venta CONFIRMADA, en la fecha de su confirmación
--   dinero cobrado    = pagos CONFIRMADOS, en la fecha de su confirmación (no cuenta pendientes, rechazados ni revertidos)
--   utilidad estimada = total de la venta - costo histórico de sus líneas (NO es dinero cobrado)
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tz constant text := 'America/Mexico_City';
  today date := (now() at time zone 'America/Mexico_City')::date;
  month_start date := date_trunc('month', (now() at time zone 'America/Mexico_City'))::date;
begin
  perform public.assert_admin();

  return jsonb_build_object(
    'today', today,
    'month_start', month_start,

    -- Venta registrada
    'sales_today', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(s.total), 0))
                    from public.sales s
                    where s.status = 'confirmed' and (s.confirmed_at at time zone tz)::date = today),
    'sales_month', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(s.total), 0))
                    from public.sales s
                    where s.status = 'confirmed' and (s.confirmed_at at time zone tz)::date >= month_start),

    -- Dinero cobrado
    'collected_today', (select jsonb_build_object(
                          'total', coalesce(sum(p.amount), 0),
                          'cash', coalesce(sum(p.amount) filter (where p.method = 'cash'), 0),
                          'transfer', coalesce(sum(p.amount) filter (where p.method = 'transfer'), 0))
                        from public.payments p
                        where p.status = 'confirmed' and (p.confirmed_at at time zone tz)::date = today),
    'collected_month', (select jsonb_build_object(
                          'total', coalesce(sum(p.amount), 0),
                          'cash', coalesce(sum(p.amount) filter (where p.method = 'cash'), 0),
                          'transfer', coalesce(sum(p.amount) filter (where p.method = 'transfer'), 0))
                        from public.payments p
                        where p.status = 'confirmed' and (p.confirmed_at at time zone tz)::date >= month_start),
    'pending_verification', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(p.amount), 0))
                             from public.payments p where p.status = 'pending'),

    -- Utilidad estimada (del mes, de las ventas registradas)
    'estimated_profit_month', (
      select coalesce(sum(s.total - coalesce(c.cost, 0)), 0)
      from public.sales s
      left join lateral (select sum(i.unit_cost * i.quantity) as cost from public.sale_items i where i.sale_id = s.id) c on true
      where s.status = 'confirmed' and (s.confirmed_at at time zone tz)::date >= month_start),

    -- Créditos, apartados y cuentas por cobrar
    'credits_active', (select count(*) from public.credits where status = 'active'),
    'receivable_credits', (select coalesce(sum(cs.balance), 0) from public.credit_summaries cs where cs.status = 'active'),
    'receivable_layaways', (select coalesce(sum(ls.balance), 0) from public.layaway_summaries ls where ls.status in ('pending_down', 'active')),
    'overdue_installments', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(st.remaining), 0))
                             from public.installment_status st where st.is_overdue),
    'overdue_layaways', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(ls.balance), 0))
                         from public.layaway_summaries ls where ls.is_expired),

    -- Inventario
    'available_units', (select count(*) from public.product_units where status = 'available'),
    'accessory_variants_in_stock', (select count(*) from public.product_variants where is_active and stock_quantity > 0),
    'accessory_pieces', (select coalesce(sum(stock_quantity), 0) from public.product_variants where is_active),

    -- Entregas
    'deliveries_open', (select count(*) from public.deliveries where status in ('pending', 'preparing', 'on_the_way')),
    'next_deliveries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'delivery_number', x.delivery_number, 'status', x.status,
        'scheduled_date', x.scheduled_date, 'customer_name', x.customer_name) order by x.scheduled_date nulls last, x.created_at)
      from (
        select d.id, d.delivery_number, d.status, d.scheduled_date, d.created_at, c.name as customer_name
        from public.deliveries d join public.sales s on s.id = d.sale_id join public.customers c on c.id = s.customer_id
        where d.status in ('pending', 'preparing', 'on_the_way')
        order by d.scheduled_date nulls last, d.created_at limit 5) x), '[]'::jsonb),

    -- Últimos 14 días: venta registrada frente a dinero cobrado
    'last_14_days', (
      select jsonb_agg(jsonb_build_object(
        'date', g.day,
        'sales_total', coalesce((select sum(s.total) from public.sales s
                                 where s.status = 'confirmed' and (s.confirmed_at at time zone tz)::date = g.day), 0),
        'collected_total', coalesce((select sum(p.amount) from public.payments p
                                     where p.status = 'confirmed' and (p.confirmed_at at time zone tz)::date = g.day), 0))
        order by g.day)
      from generate_series(today - 13, today, interval '1 day') as g(day))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Reportes por rango de fechas (inclusive, hora de Ciudad de México; máximo 366 días)
-- ---------------------------------------------------------------------------
create or replace function public.report_sales(p_from date, p_to date)
returns table (
  sale_id uuid, sale_number text, confirmed_on date, customer_name text, modality text,
  total numeric, cost numeric, estimated_profit numeric, confirmed_paid numeric, balance numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    raise exception 'Rango de fechas inválido (máximo 366 días)' using errcode = '22023';
  end if;
  return query
  select s.id, s.sale_number, (s.confirmed_at at time zone 'America/Mexico_City')::date, c.name, s.modality,
         s.total, coalesce(k.cost, 0)::numeric, (s.total - coalesce(k.cost, 0))::numeric,
         coalesce(pa.paid, 0)::numeric, (s.total - coalesce(pa.paid, 0))::numeric
  from public.sales s
  join public.customers c on c.id = s.customer_id
  left join lateral (select sum(i.unit_cost * i.quantity) as cost from public.sale_items i where i.sale_id = s.id) k on true
  left join lateral (select sum(p.amount) as paid from public.payments p where p.sale_id = s.id and p.status = 'confirmed') pa on true
  where s.status = 'confirmed'
    and (s.confirmed_at at time zone 'America/Mexico_City')::date between p_from and p_to
  order by s.confirmed_at, s.sale_number;
end;
$$;

create or replace function public.report_payments(p_from date, p_to date)
returns table (
  payment_id uuid, confirmed_on date, sale_number text, customer_name text, kind text, method text,
  amount numeric, reference text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    raise exception 'Rango de fechas inválido (máximo 366 días)' using errcode = '22023';
  end if;
  return query
  select p.id, (p.confirmed_at at time zone 'America/Mexico_City')::date, s.sale_number, c.name, p.kind, p.method,
         p.amount::numeric, p.reference
  from public.payments p
  join public.sales s on s.id = p.sale_id
  join public.customers c on c.id = s.customer_id
  where p.status = 'confirmed'
    and (p.confirmed_at at time zone 'America/Mexico_City')::date between p_from and p_to
  order by p.confirmed_at, s.sale_number;
end;
$$;

-- Totales del reporte, calculados en la base de datos (no en el navegador).
create or replace function public.report_summary(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tz constant text := 'America/Mexico_City';
begin
  perform public.assert_admin();
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    raise exception 'Rango de fechas inválido (máximo 366 días)' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'sales_count', (select count(*) from public.sales s
                    where s.status = 'confirmed' and (s.confirmed_at at time zone tz)::date between p_from and p_to),
    'sales_total', (select coalesce(sum(s.total), 0) from public.sales s
                    where s.status = 'confirmed' and (s.confirmed_at at time zone tz)::date between p_from and p_to),
    'cost_total', (select coalesce(sum(i.unit_cost * i.quantity), 0) from public.sale_items i
                   join public.sales s on s.id = i.sale_id
                   where s.status = 'confirmed' and (s.confirmed_at at time zone tz)::date between p_from and p_to),
    'collected_total', (select coalesce(sum(p.amount), 0) from public.payments p
                        where p.status = 'confirmed' and (p.confirmed_at at time zone tz)::date between p_from and p_to),
    'collected_cash', (select coalesce(sum(p.amount), 0) from public.payments p
                       where p.status = 'confirmed' and p.method = 'cash' and (p.confirmed_at at time zone tz)::date between p_from and p_to),
    'collected_transfer', (select coalesce(sum(p.amount), 0) from public.payments p
                           where p.status = 'confirmed' and p.method = 'transfer' and (p.confirmed_at at time zone tz)::date between p_from and p_to),
    'payments_count', (select count(*) from public.payments p
                       where p.status = 'confirmed' and (p.confirmed_at at time zone tz)::date between p_from and p_to)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilegios y RLS
-- ---------------------------------------------------------------------------
revoke all on function public.create_delivery(uuid, text, text, numeric, date, text, text) from public, anon;
revoke all on function public.set_delivery_status(uuid, text, text) from public, anon;
revoke all on function public.dashboard_metrics() from public, anon;
revoke all on function public.report_sales(date, date) from public, anon;
revoke all on function public.report_payments(date, date) from public, anon;
revoke all on function public.report_summary(date, date) from public, anon;
grant execute on function public.create_delivery(uuid, text, text, numeric, date, text, text) to authenticated;
grant execute on function public.set_delivery_status(uuid, text, text) to authenticated;
grant execute on function public.dashboard_metrics() to authenticated;
grant execute on function public.report_sales(date, date) to authenticated;
grant execute on function public.report_payments(date, date) to authenticated;
grant execute on function public.report_summary(date, date) to authenticated;

revoke all on public.deliveries, public.delivery_summaries from public, anon, authenticated;
grant select on public.deliveries, public.delivery_summaries to authenticated;
-- El estado, las fechas y la venta solo cambian mediante RPC; aquí solo los datos descriptivos.
grant update (address, reference_notes, delivery_cost, scheduled_date, notes) on public.deliveries to authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter table public.deliveries enable row level security;
create policy deliveries_admin_select on public.deliveries for select to authenticated
  using ((select public.is_admin()));
create policy deliveries_admin_update on public.deliveries for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
