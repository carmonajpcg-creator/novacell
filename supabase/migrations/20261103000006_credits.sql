-- Fase 4: créditos. Reglas comerciales PROPUESTAS y pendientes de aprobación: docs/PENDING_RULES.md (C1..C12).
-- Separación (CLAUDE.md §15): acuerdo de crédito (credits) / calendario (installments) /
-- pagos recibidos (payments) / aplicación de pagos (payment_allocations).
-- Orden de bloqueo único en todas las funciones: venta -> crédito -> pago -> cuotas.

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------
alter table public.payments
  add column kind text not null default 'sale' check (kind in ('sale', 'down_payment', 'installment'));

create sequence public.credit_number_seq;

create table public.credits (
  id uuid primary key default gen_random_uuid(),
  credit_number text not null unique default ('C-' || lpad(nextval('public.credit_number_seq')::text, 6, '0')),
  sale_id uuid not null unique references public.sales (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  status text not null default 'pending_down' check (status in ('pending_down', 'active', 'settled', 'cancelled')),
  -- Condiciones originales pactadas: no se modifican después de crear el crédito.
  financed_total numeric(14, 2) not null check (financed_total > 0 and financed_total <> 'NaN'::numeric),
  down_payment numeric(14, 2) not null check (down_payment >= 0 and down_payment <> 'NaN'::numeric),
  principal numeric(14, 2) not null check (principal > 0 and principal <> 'NaN'::numeric),
  frequency text not null check (frequency in ('weekly', 'biweekly', 'monthly')),
  installments_count integer not null check (installments_count between 1 and 260),
  first_due_date date not null,
  notes text check (notes is null or length(notes) <= 2000),
  settled_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (principal = financed_total - down_payment)
);
create index credits_customer_idx on public.credits (customer_id, created_at desc);
create index credits_status_idx on public.credits (status);
create trigger credits_set_updated_at before update on public.credits
  for each row execute function public.set_updated_at();

create table public.installments (
  id uuid primary key default gen_random_uuid(),
  credit_id uuid not null references public.credits (id) on delete restrict,
  number integer not null check (number >= 1),
  due_date date not null,
  amount numeric(14, 2) not null check (amount > 0 and amount <> 'NaN'::numeric),
  created_at timestamptz not null default now(),
  unique (credit_id, number)
);
create index installments_due_idx on public.installments (credit_id, due_date);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete restrict,
  installment_id uuid not null references public.installments (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0 and amount <> 'NaN'::numeric),
  -- Un reverso no borra la aplicación: la marca como revertida (historial auditable).
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (payment_id, installment_id)
);
create index payment_allocations_installment_idx on public.payment_allocations (installment_id) where reversed_at is null;

-- ---------------------------------------------------------------------------
-- Vistas (security_invoker: respetan el RLS de quien consulta)
-- ---------------------------------------------------------------------------
create view public.installment_status with (security_invoker = true) as
select
  i.id, i.credit_id, i.number, i.due_date, i.amount,
  coalesce(al.paid, 0)::numeric(14, 2) as paid,
  (i.amount - coalesce(al.paid, 0))::numeric(14, 2) as remaining,
  (c.status = 'active' and i.amount > coalesce(al.paid, 0)
    and i.due_date < (now() at time zone 'America/Mexico_City')::date) as is_overdue,
  case when c.status = 'active' and i.amount > coalesce(al.paid, 0)
            and i.due_date < (now() at time zone 'America/Mexico_City')::date
       then (now() at time zone 'America/Mexico_City')::date - i.due_date else 0 end as days_overdue
from public.installments i
join public.credits c on c.id = i.credit_id
left join lateral (
  select sum(a.amount) as paid from public.payment_allocations a
  where a.installment_id = i.id and a.reversed_at is null
) al on true;

create view public.credit_summaries with (security_invoker = true) as
select
  c.id, c.credit_number, c.sale_id, c.customer_id, cu.name as customer_name, s.sale_number,
  c.status, c.financed_total, c.down_payment, c.principal, c.frequency, c.installments_count,
  c.first_due_date, c.notes, c.created_at, c.settled_at, c.cancelled_at,
  coalesce(dp.paid, 0)::numeric(14, 2) as down_paid,
  coalesce(al.paid, 0)::numeric(14, 2) as installments_paid,
  (c.principal - coalesce(al.paid, 0))::numeric(14, 2) as balance,
  coalesce(pv.pending, 0)::numeric(14, 2) as pending_verification,
  coalesce(ov.amount, 0)::numeric(14, 2) as overdue_amount,
  coalesce(ov.cnt, 0)::integer as overdue_count,
  nx.due_date as next_due_date
from public.credits c
join public.customers cu on cu.id = c.customer_id
join public.sales s on s.id = c.sale_id
left join lateral (
  select sum(p.amount) as paid from public.payments p
  where p.sale_id = c.sale_id and p.kind = 'down_payment' and p.status = 'confirmed'
) dp on true
left join lateral (
  select sum(a.amount) as paid from public.payment_allocations a
  join public.installments i on i.id = a.installment_id
  where i.credit_id = c.id and a.reversed_at is null
) al on true
left join lateral (
  select sum(p.amount) as pending from public.payments p where p.sale_id = c.sale_id and p.status = 'pending'
) pv on true
left join lateral (
  select sum(st.remaining) as amount, count(*) as cnt from public.installment_status st
  where st.credit_id = c.id and st.is_overdue
) ov on true
left join lateral (
  select min(st.due_date) as due_date from public.installment_status st
  where st.credit_id = c.id and st.remaining > 0
) nx on true;

-- ---------------------------------------------------------------------------
-- Funciones internas
-- ---------------------------------------------------------------------------

-- Reserva inventario y crea las líneas de una venta (lógica compartida por contado y crédito).
-- Devuelve {"total": suma de líneas, "overrides": precios distintos al catálogo}.
create or replace function public.reserve_sale_items(p_sale_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  u record;
  v record;
  pname text;
  pactive boolean;
  price numeric(14, 2);
  qty integer;
  v_total numeric(14, 2) := 0;
  overrides jsonb := '[]'::jsonb;
begin
  -- Orden determinista de bloqueos (por UUID) para evitar interbloqueos.
  for item in
    select value as j from jsonb_array_elements(p_items)
    order by coalesce(value ->> 'unit_id', value ->> 'variant_id')::uuid
  loop
    if (item.j ? 'unit_id') = (item.j ? 'variant_id') then
      raise exception 'Cada línea debe indicar unit_id o variant_id' using errcode = '22023';
    end if;

    if item.j ? 'unit_id' then
      select * into u from public.product_units where id = (item.j ->> 'unit_id')::uuid for update;
      if not found then
        raise exception 'Unidad no encontrada' using errcode = 'P0002';
      end if;
      if u.status <> 'available' then
        raise exception 'La unidad % no está disponible (estado: %)', u.internal_code, u.status using errcode = '23514';
      end if;
      select name, is_active into pname, pactive from public.products where id = u.product_id;
      if not pactive then
        raise exception 'El producto % está inactivo', pname using errcode = '23514';
      end if;
      price := coalesce(nullif(item.j ->> 'unit_price', '')::numeric, u.sale_price);
      if price is null or price = 'NaN'::numeric or price < 0 or price <> round(price, 2) then
        raise exception 'Precio inválido' using errcode = '22023';
      end if;
      if price <> u.sale_price then
        overrides := overrides || jsonb_build_object('unit_id', u.id, 'catalog_price', u.sale_price, 'price', price);
      end if;
      insert into public.sale_items (sale_id, product_unit_id, description, quantity, unit_price, unit_cost)
      values (
        p_sale_id, u.id,
        pname || ' ' || u.storage_gb || ' GB ' || u.color || ' (' ||
          case u.condition when 'new' then 'Nuevo' else 'Seminuevo' end || ')',
        1, price, u.acquisition_cost
      );
      update public.product_units set status = 'reserved' where id = u.id;
      v_total := v_total + price;
    else
      qty := coalesce(nullif(item.j ->> 'quantity', '')::integer, 1);
      if qty < 1 then
        raise exception 'Cantidad inválida' using errcode = '22023';
      end if;
      select * into v from public.product_variants where id = (item.j ->> 'variant_id')::uuid for update;
      if not found then
        raise exception 'Variante no encontrada' using errcode = 'P0002';
      end if;
      if not v.is_active then
        raise exception 'La variante % está inactiva', v.sku using errcode = '23514';
      end if;
      select name, is_active into pname, pactive from public.products where id = v.product_id;
      if not pactive then
        raise exception 'El producto % está inactivo', pname using errcode = '23514';
      end if;
      if v.stock_quantity < qty then
        raise exception 'Existencias insuficientes de % (disponibles: %)', v.sku, v.stock_quantity using errcode = '23514';
      end if;
      price := coalesce(nullif(item.j ->> 'unit_price', '')::numeric, v.price);
      if price is null or price = 'NaN'::numeric or price < 0 or price <> round(price, 2) then
        raise exception 'Precio inválido' using errcode = '22023';
      end if;
      if price <> v.price then
        overrides := overrides || jsonb_build_object('variant_id', v.id, 'catalog_price', v.price, 'price', price);
      end if;
      insert into public.sale_items (sale_id, product_variant_id, description, quantity, unit_price, unit_cost)
      values (
        p_sale_id, v.id,
        pname || coalesce(' — ' || v.color, '') || coalesce(' (' || v.compatible_model || ')', '') || ' [' || v.sku || ']',
        qty, price, v.cost
      );
      update public.product_variants set stock_quantity = stock_quantity - qty where id = v.id;
      insert into public.inventory_movements (
        product_variant_id, movement_type, quantity_delta, stock_after, reason, idempotency_key
      ) values (
        v.id, 'exit', -qty, v.stock_quantity - qty, 'Venta pendiente',
        'sale:' || p_sale_id || ':variant:' || v.id
      );
      v_total := v_total + price * qty;
    end if;
  end loop;

  return jsonb_build_object('total', v_total, 'overrides', overrides);
end;
$$;

-- Marca la venta como confirmada y las unidades como vendidas (contado pagado o crédito activado).
create or replace function public.finalize_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  it record;
begin
  select * into s from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venta no encontrada' using errcode = 'P0002';
  end if;
  if s.status <> 'pending' then
    return;
  end if;

  for it in
    select product_unit_id from public.sale_items
    where sale_id = p_sale_id and product_unit_id is not null order by product_unit_id
  loop
    update public.product_units set status = 'sold' where id = it.product_unit_id and status = 'reserved';
    if not found then
      raise exception 'Inconsistencia: la unidad reservada ya no está en estado reservada' using errcode = 'XX001';
    end if;
    insert into public.inventory_movements (product_unit_id, movement_type, quantity_delta, reason, idempotency_key)
    values (it.product_unit_id, 'exit', -1, 'Venta ' || s.sale_number, 'sale:' || p_sale_id || ':unit:' || it.product_unit_id);
  end loop;

  update public.sales set status = 'confirmed', confirmed_at = now() where id = p_sale_id;
  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'confirm_sale', 'sales', p_sale_id, jsonb_build_object('total', s.total, 'modality', s.modality));
end;
$$;

create or replace function public.complete_sale_if_paid(p_sale_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  paid numeric(14, 2);
begin
  select * into s from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venta no encontrada' using errcode = 'P0002';
  end if;
  if s.status <> 'pending' or s.modality <> 'cash' then
    return false;
  end if;

  select coalesce(sum(amount), 0) into paid from public.payments
  where sale_id = p_sale_id and status = 'confirmed';
  if paid <> s.total then
    return false;
  end if;

  perform public.finalize_sale(p_sale_id);
  return true;
end;
$$;

-- Activa el crédito cuando el enganche confirmado cubre el pactado: entrega (unidades vendidas) y calendario vigente.
create or replace function public.activate_credit_if_ready(p_credit_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  paid numeric(14, 2);
begin
  select * into c from public.credits where id = p_credit_id for update;
  if not found then
    raise exception 'Crédito no encontrado' using errcode = 'P0002';
  end if;
  if c.status <> 'pending_down' then
    return false;
  end if;

  select coalesce(sum(amount), 0) into paid from public.payments
  where sale_id = c.sale_id and kind = 'down_payment' and status = 'confirmed';
  if paid < c.down_payment then
    return false;
  end if;

  perform public.finalize_sale(c.sale_id);
  update public.credits set status = 'active' where id = p_credit_id;
  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'activate_credit', 'credits', p_credit_id, jsonb_build_object('down_payment', c.down_payment));
  return true;
end;
$$;

-- Aplica un abono confirmado a las cuotas, de la más antigua a la más reciente (parcial y anticipado permitidos).
create or replace function public.allocate_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  c record;
  inst record;
  remaining numeric(14, 2);
  already numeric(14, 2);
  take numeric(14, 2);
begin
  select * into p from public.payments where id = p_payment_id;
  if not found or p.kind <> 'installment' or p.status <> 'confirmed' then
    raise exception 'Solo se aplican abonos confirmados' using errcode = '23514';
  end if;
  if exists (select 1 from public.payment_allocations where payment_id = p_payment_id) then
    return; -- ya aplicado: idempotente
  end if;

  select * into c from public.credits where sale_id = p.sale_id;
  remaining := p.amount;

  for inst in select * from public.installments where credit_id = c.id order by number loop
    select coalesce(sum(a.amount), 0) into already from public.payment_allocations a
    where a.installment_id = inst.id and a.reversed_at is null;
    if already < inst.amount then
      take := least(remaining, inst.amount - already);
      insert into public.payment_allocations (payment_id, installment_id, amount) values (p.id, inst.id, take);
      remaining := remaining - take;
      exit when remaining = 0;
    end if;
  end loop;

  if remaining > 0 then
    raise exception 'Inconsistencia: el abono excede el saldo del crédito' using errcode = 'XX001';
  end if;

  -- Liquidación: todas las cuotas cubiertas.
  if not exists (
    select 1 from public.installments i
    where i.credit_id = c.id and i.amount > (
      select coalesce(sum(a.amount), 0) from public.payment_allocations a
      where a.installment_id = i.id and a.reversed_at is null)
  ) then
    update public.credits set status = 'settled', settled_at = now() where id = c.id and status = 'active';
    insert into public.audit_logs (actor_id, action, entity, entity_id, details)
    values (auth.uid(), 'settle_credit', 'credits', c.id, jsonb_build_object('principal', c.principal));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_sale reutiliza la lógica compartida (mismo comportamiento que antes)
-- ---------------------------------------------------------------------------
create or replace function public.create_sale(
  p_customer_id uuid,
  p_source text,
  p_items jsonb,
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
  v_total numeric(14, 2);
  v_hash text;
  reserved jsonb;
begin
  perform public.assert_admin();

  if p_source not in ('facebook', 'whatsapp', 'in_person', 'other') then
    raise exception 'Origen de venta inválido' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe incluir al menos un producto' using errcode = '22023';
  end if;

  v_hash := md5(
    p_customer_id::text || '|' || p_source || '|' ||
    coalesce((select jsonb_agg(x order by x::text)::text from jsonb_array_elements(p_items) x), '')
  );

  select id, request_hash into existing from public.sales where idempotency_key = p_idempotency_key;
  if found then
    if existing.request_hash is distinct from v_hash then
      raise exception 'La clave de idempotencia ya se usó con otros datos' using errcode = '23505';
    end if;
    return existing.id;
  end if;

  if not exists (select 1 from public.customers where id = p_customer_id and is_active) then
    raise exception 'Cliente no encontrado o inactivo' using errcode = 'P0002';
  end if;

  begin
    insert into public.sales (customer_id, source, notes, idempotency_key, request_hash)
    values (p_customer_id, p_source, nullif(trim(p_notes), ''), p_idempotency_key, v_hash)
    returning id into new_sale;
  exception when unique_violation then
    select id, request_hash into existing from public.sales where idempotency_key = p_idempotency_key;
    if found then
      if existing.request_hash is distinct from v_hash then
        raise exception 'La clave de idempotencia ya se usó con otros datos' using errcode = '23505';
      end if;
      return existing.id;
    end if;
    raise;
  end;

  reserved := public.reserve_sale_items(new_sale, p_items);
  v_total := (reserved ->> 'total')::numeric;
  if v_total <= 0 then
    raise exception 'El total de la venta debe ser mayor a cero' using errcode = '22023';
  end if;
  update public.sales set total = v_total where id = new_sale;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'create_sale', 'sales', new_sale,
    jsonb_build_object('total', v_total, 'customer_id', p_customer_id, 'price_overrides', reserved -> 'overrides'));
  return new_sale;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: crear una venta a crédito (precio financiado fijado por el negocio, sin intereses automáticos)
-- ---------------------------------------------------------------------------
create or replace function public.create_credit_sale(
  p_customer_id uuid,
  p_source text,
  p_items jsonb,
  p_financed_total numeric,
  p_down_payment numeric,
  p_frequency text,
  p_installments integer,
  p_first_due_date date,
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
  new_credit uuid;
  v_hash text;
  reserved jsonb;
  v_principal numeric(14, 2);
  principal_cents bigint;
  base_cents bigint;
  i integer;
  due date;
  amt numeric(14, 2);
  allowed jsonb;
  today date := (now() at time zone 'America/Mexico_City')::date;
begin
  perform public.assert_admin();

  if p_source not in ('facebook', 'whatsapp', 'in_person', 'other') then
    raise exception 'Origen de venta inválido' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe incluir al menos un producto' using errcode = '22023';
  end if;
  if p_financed_total is null or p_financed_total = 'NaN'::numeric or p_financed_total <= 0
     or p_financed_total <> round(p_financed_total, 2) then
    raise exception 'Precio financiado inválido' using errcode = '22023';
  end if;
  if p_down_payment is null or p_down_payment = 'NaN'::numeric or p_down_payment < 0
     or p_down_payment <> round(p_down_payment, 2) or p_down_payment >= p_financed_total then
    raise exception 'El enganche debe ser menor al precio financiado' using errcode = '22023';
  end if;
  if p_frequency not in ('weekly', 'biweekly', 'monthly') then
    raise exception 'Frecuencia inválida' using errcode = '22023';
  end if;
  -- Frecuencias configurables: si el negocio definió una lista en business_settings, se respeta.
  select value into allowed from public.business_settings where key = 'credit_allowed_frequencies';
  if allowed is not null and jsonb_typeof(allowed) = 'array' and not (allowed ? p_frequency) then
    raise exception 'La frecuencia % no está habilitada', p_frequency using errcode = '23514';
  end if;
  if p_installments is null or p_installments < 1 or p_installments > 260 then
    raise exception 'Número de cuotas inválido (1 a 260)' using errcode = '22023';
  end if;
  if p_first_due_date is null or p_first_due_date < today then
    raise exception 'La primera fecha de pago no puede ser anterior a hoy' using errcode = '22023';
  end if;

  v_hash := md5(
    p_customer_id::text || '|' || p_source || '|' || p_financed_total::text || '|' || p_down_payment::text || '|' ||
    p_frequency || '|' || p_installments::text || '|' || p_first_due_date::text || '|' ||
    coalesce((select jsonb_agg(x order by x::text)::text from jsonb_array_elements(p_items) x), '')
  );

  select s.id, s.request_hash, c.id as credit_id into existing
  from public.sales s left join public.credits c on c.sale_id = s.id
  where s.idempotency_key = p_idempotency_key;
  if found then
    if existing.request_hash is distinct from v_hash or existing.credit_id is null then
      raise exception 'La clave de idempotencia ya se usó con otros datos' using errcode = '23505';
    end if;
    return existing.credit_id;
  end if;

  if not exists (select 1 from public.customers where id = p_customer_id and is_active) then
    raise exception 'Cliente no encontrado o inactivo' using errcode = 'P0002';
  end if;

  begin
    insert into public.sales (customer_id, modality, source, total, notes, idempotency_key, request_hash)
    values (p_customer_id, 'credit', p_source, p_financed_total, nullif(trim(p_notes), ''), p_idempotency_key, v_hash)
    returning id into new_sale;
  exception when unique_violation then
    select s.id, s.request_hash, c.id as credit_id into existing
    from public.sales s left join public.credits c on c.sale_id = s.id
    where s.idempotency_key = p_idempotency_key;
    if found then
      if existing.request_hash is distinct from v_hash or existing.credit_id is null then
        raise exception 'La clave de idempotencia ya se usó con otros datos' using errcode = '23505';
      end if;
      return existing.credit_id;
    end if;
    raise;
  end;

  reserved := public.reserve_sale_items(new_sale, p_items);

  v_principal := p_financed_total - p_down_payment;
  insert into public.credits (
    sale_id, customer_id, financed_total, down_payment, principal, frequency, installments_count, first_due_date, notes
  ) values (
    new_sale, p_customer_id, p_financed_total, p_down_payment, v_principal, p_frequency, p_installments,
    p_first_due_date, nullif(trim(p_notes), '')
  ) returning id into new_credit;

  -- Calendario: cuotas iguales en centavos; el residuo se suma a la última cuota (propuesta C3).
  principal_cents := round(v_principal * 100)::bigint;
  base_cents := principal_cents / p_installments;
  for i in 1..p_installments loop
    amt := (case when i = p_installments then principal_cents - base_cents * (p_installments - 1) else base_cents end)::numeric / 100;
    due := case p_frequency
      when 'weekly' then p_first_due_date + (7 * (i - 1))
      when 'biweekly' then p_first_due_date + (14 * (i - 1))
      else (p_first_due_date + ((i - 1) * interval '1 month'))::date
    end;
    insert into public.installments (credit_id, number, due_date, amount) values (new_credit, i, due, amt);
  end loop;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'create_credit_sale', 'credits', new_credit, jsonb_build_object(
    'sale_id', new_sale, 'financed_total', p_financed_total, 'down_payment', p_down_payment,
    'frequency', p_frequency, 'installments', p_installments, 'price_overrides', reserved -> 'overrides'));

  -- Sin enganche: el crédito se activa de inmediato.
  if p_down_payment = 0 then
    perform public.activate_credit_if_ready(new_credit);
  end if;
  return new_credit;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: registrar enganche o abono de un crédito
-- ---------------------------------------------------------------------------
create or replace function public.record_credit_payment(
  p_credit_id uuid,
  p_kind text,
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
  c record;
  v_sale_id uuid;
  committed numeric(14, 2);
  pay_id uuid;
begin
  perform public.assert_admin();

  if p_kind not in ('down_payment', 'installment') then
    raise exception 'Tipo de pago inválido' using errcode = '22023';
  end if;
  if p_method not in ('cash', 'transfer') then
    raise exception 'Método de pago inválido' using errcode = '22023';
  end if;
  if p_amount is null or p_amount = 'NaN'::numeric or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Importe inválido' using errcode = '22023';
  end if;

  select sale_id into v_sale_id from public.credits where id = p_credit_id;
  if v_sale_id is null then
    raise exception 'Crédito no encontrado' using errcode = 'P0002';
  end if;

  -- Orden de bloqueo: venta -> crédito.
  perform 1 from public.sales where id = v_sale_id for update;
  select * into c from public.credits where id = p_credit_id for update;

  select * into existing from public.payments where idempotency_key = p_idempotency_key;
  if found then
    if existing.sale_id <> v_sale_id or existing.method <> p_method or existing.amount <> p_amount or existing.kind <> p_kind then
      raise exception 'La clave de idempotencia ya se usó con otros datos' using errcode = '23505';
    end if;
    return existing.id;
  end if;

  if p_kind = 'down_payment' then
    if c.status <> 'pending_down' then
      raise exception 'El enganche solo se registra mientras el crédito espera enganche (estado: %)', c.status using errcode = '23514';
    end if;
    select coalesce(sum(amount), 0) into committed from public.payments
    where sale_id = v_sale_id and kind = 'down_payment' and status in ('pending', 'confirmed');
    if committed + p_amount > c.down_payment then
      raise exception 'El pago excede el enganche pactado (faltan: %)', c.down_payment - committed using errcode = '23514';
    end if;
  else
    if c.status <> 'active' then
      raise exception 'Los abonos solo se registran en créditos activos (estado: %)', c.status using errcode = '23514';
    end if;
    select coalesce(sum(amount), 0) into committed from public.payments
    where sale_id = v_sale_id and kind = 'installment' and status in ('pending', 'confirmed');
    if committed + p_amount > c.principal then
      raise exception 'El abono excede el saldo del crédito (saldo por cubrir: %)', c.principal - committed using errcode = '23514';
    end if;
  end if;

  begin
    insert into public.payments (sale_id, kind, method, amount, status, reference, confirmed_at, confirmed_by, status_changed_at, idempotency_key)
    values (
      v_sale_id, p_kind, p_method, p_amount,
      case p_method when 'cash' then 'confirmed' else 'pending' end,
      nullif(trim(p_reference), ''),
      case p_method when 'cash' then now() end,
      case p_method when 'cash' then auth.uid() end,
      now(), p_idempotency_key
    ) returning id into pay_id;
  exception when unique_violation then
    select * into existing from public.payments where idempotency_key = p_idempotency_key;
    if found then
      if existing.sale_id <> v_sale_id or existing.method <> p_method or existing.amount <> p_amount or existing.kind <> p_kind then
        raise exception 'La clave de idempotencia ya se usó con otros datos' using errcode = '23505';
      end if;
      return existing.id;
    end if;
    raise;
  end;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'record_credit_payment', 'payments', pay_id,
    jsonb_build_object('credit_id', p_credit_id, 'sale_id', v_sale_id, 'kind', p_kind, 'method', p_method, 'amount', p_amount));

  if p_method = 'cash' then
    if p_kind = 'down_payment' then
      perform public.activate_credit_if_ready(p_credit_id);
    else
      perform public.allocate_payment(pay_id);
    end if;
  end if;
  return pay_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Funciones existentes, ahora con soporte de crédito
-- ---------------------------------------------------------------------------
create or replace function public.record_payment(
  p_sale_id uuid,
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
  s record;
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

  select * into existing from public.payments where idempotency_key = p_idempotency_key;
  if found then
    if existing.sale_id <> p_sale_id or existing.method <> p_method or existing.amount <> p_amount then
      raise exception 'La clave de idempotencia ya se usó con otros datos' using errcode = '23505';
    end if;
    return existing.id;
  end if;

  select * into s from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venta no encontrada' using errcode = 'P0002';
  end if;
  if s.modality <> 'cash' then
    raise exception 'Los pagos de una venta a crédito se registran desde el crédito' using errcode = '23514';
  end if;

  select * into existing from public.payments where idempotency_key = p_idempotency_key;
  if found then
    if existing.sale_id <> p_sale_id or existing.method <> p_method or existing.amount <> p_amount then
      raise exception 'La clave de idempotencia ya se usó con otros datos' using errcode = '23505';
    end if;
    return existing.id;
  end if;

  if s.status <> 'pending' then
    raise exception 'Solo se registran pagos en ventas pendientes (estado: %)', s.status using errcode = '23514';
  end if;

  select coalesce(sum(amount), 0) into committed from public.payments
  where sale_id = p_sale_id and status in ('pending', 'confirmed');
  if committed + p_amount > s.total then
    raise exception 'El pago excede el saldo de la venta (saldo: %)', s.total - committed using errcode = '23514';
  end if;

  insert into public.payments (sale_id, method, amount, status, reference, confirmed_at, confirmed_by, status_changed_at, idempotency_key)
  values (
    p_sale_id, p_method, p_amount,
    case p_method when 'cash' then 'confirmed' else 'pending' end,
    nullif(trim(p_reference), ''),
    case p_method when 'cash' then now() end,
    case p_method when 'cash' then auth.uid() end,
    now(), p_idempotency_key
  ) returning id into pay_id;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'record_payment', 'payments', pay_id,
    jsonb_build_object('sale_id', p_sale_id, 'method', p_method, 'amount', p_amount));

  if p_method = 'cash' then
    perform public.complete_sale_if_paid(p_sale_id);
  end if;
  return pay_id;
end;
$$;

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
begin
  perform public.assert_admin();

  -- Orden de bloqueo: venta -> crédito -> pago.
  select sale_id into v_sale_id from public.payments where id = p_payment_id;
  if v_sale_id is null then
    raise exception 'Pago no encontrado' using errcode = 'P0002';
  end if;
  select status into s_status from public.sales where id = v_sale_id for update;
  select * into c from public.credits where sale_id = v_sale_id for update;
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
  elsif p.kind = 'down_payment' then
    if c.status <> 'pending_down' then
      raise exception 'Revertir el enganche de un crédito ya activo requiere una política aprobada por el negocio'
        using errcode = '0A000';
    end if;
  else
    -- Abono: se conserva el registro y se marcan como revertidas sus aplicaciones; un crédito liquidado vuelve a activo.
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
  if s.status = 'cancelled' then
    return 'cancelled';
  end if;
  if s.status <> 'pending' then
    raise exception 'La cancelación de ventas confirmadas requiere una política aprobada por el negocio'
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
  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'cancel_sale', 'sales', p_sale_id, jsonb_build_object('reason', trim(p_reason)));
  return 'cancelled';
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilegios y RLS
-- ---------------------------------------------------------------------------
revoke all on function public.reserve_sale_items(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_sale(uuid) from public, anon, authenticated;
revoke all on function public.activate_credit_if_ready(uuid) from public, anon, authenticated;
revoke all on function public.allocate_payment(uuid) from public, anon, authenticated;
revoke all on function public.create_credit_sale(uuid, text, jsonb, numeric, numeric, text, integer, date, text, text) from public, anon;
revoke all on function public.record_credit_payment(uuid, text, text, numeric, text, text) from public, anon;
grant execute on function public.create_credit_sale(uuid, text, jsonb, numeric, numeric, text, integer, date, text, text) to authenticated;
grant execute on function public.record_credit_payment(uuid, text, text, numeric, text, text) to authenticated;

revoke all on public.credits, public.installments, public.payment_allocations,
  public.installment_status, public.credit_summaries from anon, authenticated;
grant select on public.credits, public.installments, public.payment_allocations,
  public.installment_status, public.credit_summaries to authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter table public.credits enable row level security;
alter table public.installments enable row level security;
alter table public.payment_allocations enable row level security;

create policy credits_admin_select on public.credits for select to authenticated
  using ((select public.is_admin()));
create policy installments_admin_select on public.installments for select to authenticated
  using ((select public.is_admin()));
create policy payment_allocations_admin_select on public.payment_allocations for select to authenticated
  using ((select public.is_admin()));
