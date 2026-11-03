-- Fase 5 (1/2): apartados. Reglas comerciales PROPUESTAS y pendientes de aprobación: docs/PENDING_RULES.md (L1..L10).
-- Un apartado es una venta pendiente (modalidad 'layaway') con anticipo pactado y fecha límite.
-- Reutiliza reserve_sale_items (inventario) y finalize_sale (entrega); los pagos usan payments con kind='layaway'.
-- Orden de bloqueo: venta -> apartado -> pago. NO se libera ninguna reserva vencida automáticamente (CLAUDE.md §11).

-- ---------------------------------------------------------------------------
-- Ajustes de tablas existentes
-- ---------------------------------------------------------------------------
alter table public.sales drop constraint sales_modality_check;
alter table public.sales add constraint sales_modality_check check (modality in ('cash', 'credit', 'layaway'));

alter table public.payments drop constraint payments_kind_check;
alter table public.payments add constraint payments_kind_check check (kind in ('sale', 'down_payment', 'installment', 'layaway'));

create or replace function public.check_payment_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  m text;
begin
  select modality into m from public.sales where id = new.sale_id;
  if (new.kind = 'sale' and m <> 'cash')
     or (new.kind in ('down_payment', 'installment') and m <> 'credit')
     or (new.kind = 'layaway' and m <> 'layaway') then
    raise exception 'El tipo de pago (%) no corresponde a la modalidad de la venta (%)', new.kind, m using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- layaways
-- ---------------------------------------------------------------------------
create sequence public.layaway_number_seq;

create table public.layaways (
  id uuid primary key default gen_random_uuid(),
  layaway_number text not null unique default ('A-' || lpad(nextval('public.layaway_number_seq')::text, 6, '0')),
  sale_id uuid not null unique references public.sales (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  status text not null default 'pending_down'
    check (status in ('pending_down', 'active', 'settled', 'converted', 'cancelled')),
  down_payment numeric(14, 2) not null check (down_payment > 0 and down_payment <> 'NaN'::numeric),
  due_date date not null,
  notes text check (notes is null or length(notes) <= 2000),
  settled_at timestamptz,
  converted_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'converted') = (converted_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check (status not in ('settled', 'converted') or settled_at is not null)
);
create index layaways_customer_idx on public.layaways (customer_id, created_at desc);
create index layaways_status_idx on public.layaways (status, due_date);
create trigger layaways_set_updated_at before update on public.layaways
  for each row execute function public.set_updated_at();

create view public.layaway_summaries with (security_invoker = true) as
select
  l.id, l.layaway_number, l.sale_id, l.customer_id, cu.name as customer_name, cu.phone as customer_phone,
  s.sale_number, l.status, l.down_payment, s.total, l.due_date, l.notes,
  l.created_at, l.settled_at, l.converted_at, l.cancelled_at,
  coalesce(cp.paid, 0)::numeric(14, 2) as confirmed_paid,
  coalesce(pv.pending, 0)::numeric(14, 2) as pending_verification,
  (case when l.status = 'cancelled' then 0 else s.total - coalesce(cp.paid, 0) end)::numeric(14, 2) as balance,
  (l.status in ('pending_down', 'active') and l.due_date < (now() at time zone 'America/Mexico_City')::date) as is_expired,
  case when l.status in ('pending_down', 'active') and l.due_date < (now() at time zone 'America/Mexico_City')::date
       then (now() at time zone 'America/Mexico_City')::date - l.due_date else 0 end as days_overdue
from public.layaways l
join public.customers cu on cu.id = l.customer_id
join public.sales s on s.id = l.sale_id
left join lateral (
  select sum(p.amount) as paid from public.payments p
  where p.sale_id = l.sale_id and p.kind = 'layaway' and p.status = 'confirmed'
) cp on true
left join lateral (
  select sum(p.amount) as pending from public.payments p
  where p.sale_id = l.sale_id and p.kind = 'layaway' and p.status = 'pending'
) pv on true;

-- ---------------------------------------------------------------------------
-- Interna: recalcula el estado del apartado a partir de los pagos CONFIRMADOS
-- ---------------------------------------------------------------------------
create or replace function public.refresh_layaway_status(p_layaway_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  l record;
  v_total numeric(14, 2);
  paid numeric(14, 2);
  target text;
begin
  perform 1 from public.sales where id = (select sale_id from public.layaways where id = p_layaway_id) for update;
  select * into l from public.layaways where id = p_layaway_id for update;
  if not found then
    raise exception 'Apartado no encontrado' using errcode = 'P0002';
  end if;
  if l.status not in ('pending_down', 'active', 'settled') then
    return l.status;
  end if;

  select total into v_total from public.sales where id = l.sale_id;
  select coalesce(sum(amount), 0) into paid from public.payments
  where sale_id = l.sale_id and kind = 'layaway' and status = 'confirmed';

  target := case when paid >= v_total then 'settled' when paid >= l.down_payment then 'active' else 'pending_down' end;
  if target <> l.status then
    update public.layaways
    set status = target,
        settled_at = case when target = 'settled' then now() else null end
    where id = p_layaway_id;
    insert into public.audit_logs (actor_id, action, entity, entity_id, details)
    values (auth.uid(), 'layaway_status', 'layaways', p_layaway_id,
      jsonb_build_object('from', l.status, 'to', target, 'confirmed_paid', paid));
  end if;
  return target;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: crear un apartado (reserva el inventario, anticipo pactado y fecha límite)
-- ---------------------------------------------------------------------------
create or replace function public.create_layaway(
  p_customer_id uuid,
  p_source text,
  p_items jsonb,
  p_down_payment numeric,
  p_due_date date,
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
  new_sale uuid;
  new_layaway uuid;
  v_hash text;
  reserved jsonb;
  v_total numeric(14, 2);
  minpct numeric;
  today date := (now() at time zone 'America/Mexico_City')::date;
begin
  perform public.assert_admin();

  if p_source not in ('facebook', 'whatsapp', 'in_person', 'other') then
    raise exception 'Origen inválido' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El apartado debe incluir al menos un producto' using errcode = '22023';
  end if;
  if p_down_payment is null or p_down_payment = 'NaN'::numeric or p_down_payment <= 0
     or p_down_payment <> round(p_down_payment, 2) then
    raise exception 'Anticipo inválido' using errcode = '22023';
  end if;
  if p_due_date is null or p_due_date < today or p_due_date > today + 365 then
    raise exception 'La fecha límite debe estar entre hoy y un año' using errcode = '22023';
  end if;

  v_hash := md5(
    p_customer_id::text || '|' || p_source || '|' || round(p_down_payment, 2)::text || '|' || p_due_date::text || '|' ||
    coalesce((select jsonb_agg(x order by x::text)::text from jsonb_array_elements(p_items) x), '')
  );

  select s.id, s.request_hash, l.id as layaway_id into existing
  from public.sales s left join public.layaways l on l.sale_id = s.id
  where s.idempotency_key = p_idempotency_key;
  if found then
    if existing.request_hash is distinct from v_hash or existing.layaway_id is null then
      raise exception 'La clave de idempotencia ya se usó con otros datos' using errcode = '23505';
    end if;
    return existing.layaway_id;
  end if;

  if not exists (select 1 from public.customers where id = p_customer_id and is_active) then
    raise exception 'Cliente no encontrado o inactivo' using errcode = 'P0002';
  end if;

  begin
    insert into public.sales (customer_id, modality, source, notes, idempotency_key, request_hash)
    values (p_customer_id, 'layaway', p_source, nullif(trim(p_notes), ''), p_idempotency_key, v_hash)
    returning id into new_sale;
  exception when unique_violation then
    select s.id, s.request_hash, l.id as layaway_id into existing
    from public.sales s left join public.layaways l on l.sale_id = s.id
    where s.idempotency_key = p_idempotency_key;
    if found then
      if existing.request_hash is distinct from v_hash or existing.layaway_id is null then
        raise exception 'La clave de idempotencia ya se usó con otros datos' using errcode = '23505';
      end if;
      return existing.layaway_id;
    end if;
    raise;
  end;

  reserved := public.reserve_sale_items(new_sale, p_items);
  v_total := (reserved ->> 'total')::numeric;
  if v_total <= 0 then
    raise exception 'El total del apartado debe ser mayor a cero' using errcode = '22023';
  end if;
  if p_down_payment > v_total then
    raise exception 'El anticipo no puede exceder el total del apartado' using errcode = '22023';
  end if;
  -- Anticipo mínimo configurable (business_settings.layaway_min_down_percent). Sin valor definido: solo se exige > 0.
  select (value #>> '{}')::numeric into minpct from public.business_settings where key = 'layaway_min_down_percent';
  if minpct is not null and p_down_payment * 100 < v_total * minpct then
    raise exception 'El anticipo mínimo es el % por ciento del total', minpct using errcode = '23514';
  end if;

  update public.sales set total = v_total where id = new_sale;
  insert into public.layaways (sale_id, customer_id, down_payment, due_date, notes)
  values (new_sale, p_customer_id, p_down_payment, p_due_date, nullif(trim(p_notes), ''))
  returning id into new_layaway;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'create_layaway', 'layaways', new_layaway,
    jsonb_build_object('sale_id', new_sale, 'total', v_total, 'down_payment', p_down_payment, 'due_date', p_due_date,
      'price_overrides', reserved -> 'overrides'));
  return new_layaway;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: registrar un pago (anticipo o abono) de un apartado
-- ---------------------------------------------------------------------------
create or replace function public.record_layaway_payment(
  p_layaway_id uuid,
  p_method text,
  p_amount numeric,
  p_reference text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing record;
  l record;
  v_sale_id uuid;
  v_total numeric(14, 2);
  committed numeric(14, 2);
  pay_id uuid;
begin
  perform public.assert_admin();

  if p_method not in ('cash', 'transfer') then
    raise exception 'Método de pago inválido' using errcode = '22023';
  end if;
  if p_amount is null or p_amount = 'NaN'::numeric or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Importe inválido' using errcode = '22023';
  end if;

  select sale_id into v_sale_id from public.layaways where id = p_layaway_id;
  if v_sale_id is null then
    raise exception 'Apartado no encontrado' using errcode = 'P0002';
  end if;

  -- Orden de bloqueo: venta -> apartado.
  select total into v_total from public.sales where id = v_sale_id for update;
  select * into l from public.layaways where id = p_layaway_id for update;

  select * into existing from public.payments where idempotency_key = p_idempotency_key;
  if found then
    if existing.sale_id <> v_sale_id or existing.method <> p_method or existing.amount <> p_amount
       or existing.kind <> 'layaway' or existing.reference is distinct from nullif(trim(p_reference), '') then
      raise exception 'La clave de idempotencia ya se usó con otros datos' using errcode = '23505';
    end if;
    return existing.id;
  end if;

  if l.status not in ('pending_down', 'active') then
    raise exception 'Solo se registran pagos en apartados vigentes (estado: %)', l.status using errcode = '23514';
  end if;

  select coalesce(sum(amount), 0) into committed from public.payments
  where sale_id = v_sale_id and kind = 'layaway' and status in ('pending', 'confirmed');
  if committed + p_amount > v_total then
    raise exception 'El pago excede el saldo del apartado (saldo por cubrir: %)', v_total - committed using errcode = '23514';
  end if;

  begin
    insert into public.payments (sale_id, kind, method, amount, status, reference, confirmed_at, confirmed_by, status_changed_at, idempotency_key)
    values (
      v_sale_id, 'layaway', p_method, p_amount,
      case p_method when 'cash' then 'confirmed' else 'pending' end,
      nullif(trim(p_reference), ''),
      case p_method when 'cash' then now() end,
      case p_method when 'cash' then auth.uid() end,
      now(), p_idempotency_key
    ) returning id into pay_id;
  exception when unique_violation then
    select * into existing from public.payments where idempotency_key = p_idempotency_key;
    if found then
      if existing.sale_id <> v_sale_id or existing.method <> p_method or existing.amount <> p_amount
         or existing.kind <> 'layaway' or existing.reference is distinct from nullif(trim(p_reference), '') then
        raise exception 'La clave de idempotencia ya se usó con otros datos' using errcode = '23505';
      end if;
      return existing.id;
    end if;
    raise;
  end;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'record_layaway_payment', 'payments', pay_id,
    jsonb_build_object('layaway_id', p_layaway_id, 'sale_id', v_sale_id, 'method', p_method, 'amount', p_amount));

  if p_method = 'cash' then
    perform public.refresh_layaway_status(p_layaway_id);
  end if;
  return pay_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: convertir un apartado liquidado en venta (entrega: unidades vendidas, venta confirmada)
-- ---------------------------------------------------------------------------
create or replace function public.convert_layaway(p_layaway_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  l record;
  v_total numeric(14, 2);
  paid numeric(14, 2);
begin
  perform public.assert_admin();

  select * into l from public.layaways where id = p_layaway_id;
  if not found then
    raise exception 'Apartado no encontrado' using errcode = 'P0002';
  end if;
  select total into v_total from public.sales where id = l.sale_id for update;
  select * into l from public.layaways where id = p_layaway_id for update;

  if l.status = 'converted' then
    return 'converted';
  end if;
  if l.status <> 'settled' then
    raise exception 'Solo se convierte un apartado liquidado (estado: %)', l.status using errcode = '23514';
  end if;
  select coalesce(sum(amount), 0) into paid from public.payments
  where sale_id = l.sale_id and kind = 'layaway' and status = 'confirmed';
  if paid <> v_total then
    raise exception 'El apartado no está cubierto por pagos confirmados' using errcode = '23514';
  end if;

  perform public.finalize_sale(l.sale_id);
  update public.layaways set status = 'converted', converted_at = now() where id = p_layaway_id;
  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'convert_layaway', 'layaways', p_layaway_id, jsonb_build_object('sale_id', l.sale_id, 'total', v_total));
  return 'converted';
end;
$$;

-- ---------------------------------------------------------------------------
-- Funciones existentes con soporte de apartados
-- ---------------------------------------------------------------------------
create or replace function public.confirm_payment(p_payment_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  s_status text;
  v_sale_id uuid;
  c record;
  l record;
begin
  perform public.assert_admin();

  -- Orden de bloqueo: venta -> crédito/apartado -> pago.
  select sale_id into v_sale_id from public.payments where id = p_payment_id;
  if v_sale_id is null then
    raise exception 'Pago no encontrado' using errcode = 'P0002';
  end if;
  select status into s_status from public.sales where id = v_sale_id for update;
  select * into c from public.credits where sale_id = v_sale_id for update;
  select * into l from public.layaways where sale_id = v_sale_id for update;
  select * into p from public.payments where id = p_payment_id for update;
  if p.status = 'confirmed' then
    return 'confirmed';
  end if;
  if p.status <> 'pending' then
    raise exception 'Solo se confirman pagos pendientes (estado: %)', p.status using errcode = '23514';
  end if;

  if p.kind = 'sale' then
    if s_status <> 'pending' then
      raise exception 'La venta ya no está pendiente (estado: %)', s_status using errcode = '23514';
    end if;
  elsif p.kind = 'layaway' then
    if l.status not in ('pending_down', 'active') then
      raise exception 'El apartado ya no admite pagos (estado: %)', l.status using errcode = '23514';
    end if;
  elsif p.kind = 'down_payment' then
    if c.status <> 'pending_down' then
      raise exception 'El crédito ya no espera enganche (estado: %)', c.status using errcode = '23514';
    end if;
  else
    if c.status <> 'active' then
      raise exception 'El crédito no está activo (estado: %)', c.status using errcode = '23514';
    end if;
  end if;

  update public.payments
  set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid(), status_changed_at = now()
  where id = p_payment_id;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'confirm_payment', 'payments', p_payment_id,
    jsonb_build_object('sale_id', p.sale_id, 'amount', p.amount, 'kind', p.kind));

  if p.kind = 'sale' then
    perform public.complete_sale_if_paid(p.sale_id);
  elsif p.kind = 'layaway' then
    perform public.refresh_layaway_status(l.id);
  elsif p.kind = 'down_payment' then
    perform public.activate_credit_if_ready(c.id);
  else
    perform public.allocate_payment(p_payment_id);
  end if;
  return 'confirmed';
end;
$$;

create or replace function public.reverse_payment(p_payment_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  s_status text;
  v_sale_id uuid;
  c record;
  l record;
begin
  perform public.assert_admin();
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'El motivo es obligatorio' using errcode = '22023';
  end if;

  select sale_id into v_sale_id from public.payments where id = p_payment_id;
  if v_sale_id is null then
    raise exception 'Pago no encontrado' using errcode = 'P0002';
  end if;
  select status into s_status from public.sales where id = v_sale_id for update;
  select * into c from public.credits where sale_id = v_sale_id for update;
  select * into l from public.layaways where sale_id = v_sale_id for update;
  select * into p from public.payments where id = p_payment_id for update;
  if p.status = 'reversed' then
    return 'reversed';
  end if;
  if p.status <> 'confirmed' then
    raise exception 'Solo se revierten pagos confirmados (estado: %)', p.status using errcode = '23514';
  end if;

  if p.kind = 'sale' then
    if s_status <> 'pending' then
      raise exception 'Revertir un pago de una venta confirmada requiere una política aprobada por el negocio'
        using errcode = '0A000';
    end if;
  elsif p.kind = 'layaway' then
    if l.status not in ('pending_down', 'active', 'settled') then
      raise exception 'Revertir un pago de un apartado ya convertido o cancelado requiere una política aprobada por el negocio'
        using errcode = '0A000';
    end if;
  elsif p.kind = 'down_payment' then
    if c.status <> 'pending_down' then
      raise exception 'Revertir el enganche de un crédito ya activo requiere una política aprobada por el negocio'
        using errcode = '0A000';
    end if;
  else
    update public.payment_allocations set reversed_at = now() where payment_id = p_payment_id and reversed_at is null;
    if c.status = 'settled' then
      update public.credits set status = 'active', settled_at = null where id = c.id;
    end if;
  end if;

  update public.payments set status = 'reversed', status_reason = trim(p_reason), status_changed_at = now()
  where id = p_payment_id;
  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'reverse_payment', 'payments', p_payment_id,
    jsonb_build_object('sale_id', p.sale_id, 'kind', p.kind, 'reason', trim(p_reason)));

  if p.kind = 'layaway' then
    perform public.refresh_layaway_status(l.id);
  end if;
  return 'reversed';
end;
$$;

create or replace function public.cancel_sale(p_sale_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  c record;
  l record;
  it record;
  v_stock integer;
begin
  perform public.assert_admin();
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'El motivo es obligatorio' using errcode = '22023';
  end if;

  select * into s from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venta no encontrada' using errcode = 'P0002';
  end if;
  select * into c from public.credits where sale_id = p_sale_id for update;
  select * into l from public.layaways where sale_id = p_sale_id for update;
  if s.status = 'cancelled' then
    return 'cancelled';
  end if;
  if s.status <> 'pending' then
    raise exception 'La cancelación de ventas confirmadas requiere una política aprobada por el negocio'
      using errcode = '0A000';
  end if;
  -- Apartado con pagos confirmados: devolución o retención del anticipo = política no definida (CLAUDE.md §11).
  if l.id is not null and exists (select 1 from public.payments where sale_id = p_sale_id and status = 'confirmed') then
    raise exception 'Cancelar un apartado con pagos confirmados requiere una política de devolución o retención de anticipos aprobada por el negocio'
      using errcode = '0A000';
  end if;
  if exists (select 1 from public.payments where sale_id = p_sale_id and status = 'confirmed') then
    raise exception 'Revierte primero los pagos confirmados de esta venta' using errcode = '23514';
  end if;

  update public.payments
  set status = 'rejected', status_reason = 'Venta cancelada', status_changed_at = now()
  where sale_id = p_sale_id and status = 'pending';

  for it in select * from public.sale_items where sale_id = p_sale_id order by coalesce(product_unit_id, product_variant_id) loop
    if it.product_unit_id is not null then
      update public.product_units set status = 'available' where id = it.product_unit_id and status = 'reserved';
      if not found then
        raise exception 'Inconsistencia: la unidad de la venta no estaba reservada' using errcode = 'XX001';
      end if;
    else
      select stock_quantity into v_stock from public.product_variants where id = it.product_variant_id for update;
      update public.product_variants set stock_quantity = stock_quantity + it.quantity where id = it.product_variant_id;
      insert into public.inventory_movements (
        product_variant_id, movement_type, quantity_delta, stock_after, reason, idempotency_key
      ) values (
        it.product_variant_id, 'entry', it.quantity, v_stock + it.quantity, 'Cancelación de venta ' || s.sale_number,
        'sale:' || p_sale_id || ':cancel:variant:' || it.product_variant_id
      );
    end if;
  end loop;

  update public.sales set status = 'cancelled', cancelled_at = now(), cancel_reason = trim(p_reason) where id = p_sale_id;
  if c.id is not null then
    update public.credits set status = 'cancelled', cancelled_at = now() where id = c.id;
  end if;
  if l.id is not null then
    update public.layaways set status = 'cancelled', cancelled_at = now() where id = l.id;
  end if;
  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'cancel_sale', 'sales', p_sale_id, jsonb_build_object('reason', trim(p_reason)));
  return 'cancelled';
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilegios y RLS
-- ---------------------------------------------------------------------------
revoke all on function public.refresh_layaway_status(uuid) from public, anon, authenticated;
revoke all on function public.create_layaway(uuid, text, jsonb, numeric, date, text, text) from public, anon;
revoke all on function public.record_layaway_payment(uuid, text, numeric, text, text) from public, anon;
revoke all on function public.convert_layaway(uuid) from public, anon;
grant execute on function public.create_layaway(uuid, text, jsonb, numeric, date, text, text) to authenticated;
grant execute on function public.record_layaway_payment(uuid, text, numeric, text, text) to authenticated;
grant execute on function public.convert_layaway(uuid) to authenticated;

revoke all on public.layaways, public.layaway_summaries from anon, authenticated;
grant select on public.layaways, public.layaway_summaries to authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter table public.layaways enable row level security;
create policy layaways_admin_select on public.layaways for select to authenticated
  using ((select public.is_admin()));
