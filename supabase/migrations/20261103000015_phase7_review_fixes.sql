-- Correcciones tras la revisión adversarial de la Fase 7 (Opus):
--  edición de entregas por función (valida y audita), serie de 14 días como DATE, reversos visibles (R9),
--  productos inactivos fuera de 'disponibles' (R6), idempotencia estricta, límite de rango, estado nulo e índices.

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
  v_cost numeric; -- sin escala: asignar a numeric(14,2) redondearía en silencio un costo con 3 decimales antes de validarlo
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
    if existing.sale_id <> p_sale_id or existing.address <> trim(p_address)
       or existing.delivery_cost <> v_cost or existing.scheduled_date is distinct from p_scheduled_date
       or existing.reference_notes is distinct from nullif(trim(p_reference_notes), '')
       or existing.notes is distinct from nullif(trim(p_notes), '') then
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
    if existing.sale_id <> p_sale_id or existing.address <> trim(p_address)
       or existing.delivery_cost <> v_cost or existing.scheduled_date is distinct from p_scheduled_date
       or existing.reference_notes is distinct from nullif(trim(p_reference_notes), '')
       or existing.notes is distinct from nullif(trim(p_notes), '') then
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

  if p_status is null or p_status not in ('pending', 'preparing', 'on_the_way', 'delivered', 'cancelled') then
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
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 365 then
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
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 365 then
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
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 365 then
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
                       where p.status = 'confirmed' and (p.confirmed_at at time zone tz)::date between p_from and p_to),
    'reversed_count', (select count(*) from public.payments p
                       where p.status = 'reversed' and (p.status_changed_at at time zone tz)::date between p_from and p_to),
    'reversed_total', (select coalesce(sum(p.amount), 0) from public.payments p
                       where p.status = 'reversed' and (p.status_changed_at at time zone tz)::date between p_from and p_to)
  );
end;
$$;

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

    -- Reversos (R9): pagos confirmados que luego se revirtieron, por fecha del reverso
    'reversed_today', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(p.amount), 0))
                       from public.payments p where p.status = 'reversed' and (p.status_changed_at at time zone tz)::date = today),
    'reversed_month', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(p.amount), 0))
                       from public.payments p where p.status = 'reversed' and (p.status_changed_at at time zone tz)::date >= month_start),

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
    'available_units', (select count(*) from public.product_units u join public.products pr on pr.id = u.product_id where u.status = 'available' and pr.is_active),
    'accessory_variants_in_stock', (select count(*) from public.product_variants v join public.products pr on pr.id = v.product_id where v.is_active and pr.is_active and v.stock_quantity > 0),
    'accessory_pieces', (select coalesce(sum(v.stock_quantity), 0) from public.product_variants v join public.products pr on pr.id = v.product_id where v.is_active and pr.is_active),

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
        'date', ds.day,
        'sales_total', coalesce((select sum(s.total) from public.sales s
                                 where s.status = 'confirmed' and (s.confirmed_at at time zone tz)::date = ds.day), 0),
        'collected_total', coalesce((select sum(p.amount) from public.payments p
                                     where p.status = 'confirmed' and (p.confirmed_at at time zone tz)::date = ds.day), 0))
        order by ds.day)
      from generate_series(0, 13) as g(i) cross join lateral (select today - 13 + g.i as day) ds)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Edición de una entrega: pasa por una función que valida igual que create_delivery y deja rastro en la bitácora.
-- (El UPDATE directo se retira: el trigger BEFORE ya recibe el costo redondeado a 2 decimales y no puede detectarlo.)
-- ---------------------------------------------------------------------------
create or replace function public.update_delivery(
  p_delivery_id uuid,
  p_address text,
  p_reference_notes text,
  p_cost numeric,
  p_scheduled_date date,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
  v_cost numeric;
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

  select * into d from public.deliveries where id = p_delivery_id for update;
  if not found then
    raise exception 'Entrega no encontrada' using errcode = 'P0002';
  end if;
  if d.status in ('delivered', 'cancelled') then
    raise exception 'Una entrega % ya no se puede editar', d.status using errcode = '23514';
  end if;
  -- La fecha solo se valida si cambia (una entrega ya reprogramada puede conservar su fecha original).
  if p_scheduled_date is not null and p_scheduled_date is distinct from d.scheduled_date
     and (p_scheduled_date < today or p_scheduled_date > today + 365) then
    raise exception 'La fecha programada debe estar entre hoy y un año' using errcode = '22023';
  end if;

  update public.deliveries
  set address = trim(p_address),
      reference_notes = nullif(trim(p_reference_notes), ''),
      delivery_cost = v_cost,
      scheduled_date = p_scheduled_date,
      notes = nullif(trim(p_notes), '')
  where id = p_delivery_id;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'update_delivery', 'deliveries', p_delivery_id, jsonb_build_object(
    'before', jsonb_build_object('delivery_cost', d.delivery_cost, 'scheduled_date', d.scheduled_date, 'address_changed', d.address <> trim(p_address)),
    'after', jsonb_build_object('delivery_cost', v_cost, 'scheduled_date', p_scheduled_date)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Reversos del periodo (R9): un reverso no cambia en silencio el pasado; se muestra por su fecha de reverso.
-- ---------------------------------------------------------------------------
create or replace function public.report_reversals(p_from date, p_to date)
returns table (
  payment_id uuid, reversed_on date, confirmed_on date, sale_number text, customer_name text, kind text,
  method text, amount numeric, reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 365 then
    raise exception 'Rango de fechas inválido (máximo 366 días)' using errcode = '22023';
  end if;
  return query
  select p.id, (p.status_changed_at at time zone 'America/Mexico_City')::date,
         (p.confirmed_at at time zone 'America/Mexico_City')::date, s.sale_number, c.name, p.kind, p.method,
         p.amount::numeric, p.status_reason
  from public.payments p
  join public.sales s on s.id = p.sale_id
  join public.customers c on c.id = s.customer_id
  where p.status = 'reversed'
    and (p.status_changed_at at time zone 'America/Mexico_City')::date between p_from and p_to
  order by p.status_changed_at, s.sale_number;
end;
$$;

-- Índices para los cortes por fecha de confirmación.
create index if not exists sales_status_confirmed_idx on public.sales (status, confirmed_at);
create index if not exists payments_status_confirmed_idx on public.payments (status, confirmed_at);
create index if not exists payments_reversed_idx on public.payments (status_changed_at) where status = 'reversed';

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------
revoke update on public.deliveries from authenticated;
revoke all on function public.update_delivery(uuid, text, text, numeric, date, text) from public, anon;
revoke all on function public.report_reversals(date, date) from public, anon;
grant execute on function public.update_delivery(uuid, text, text, numeric, date, text) to authenticated;
grant execute on function public.report_reversals(date, date) to authenticated;
