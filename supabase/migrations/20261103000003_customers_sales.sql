-- Fase 3: clientes y ventas de contado.
-- Reglas comerciales PROPUESTAS y pendientes de aprobación: ver docs/PENDING_RULES.md.
-- Todas las operaciones sobre ventas y pagos pasan por funciones RPC transaccionales;
-- el cliente (navegador) solo puede leer.

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  phone text check (phone is null or phone ~ '^[0-9]{10}$'),
  contact_method text not null default 'whatsapp'
    check (contact_method in ('whatsapp', 'phone', 'facebook', 'in_person', 'other')),
  acquisition_source text not null default 'other'
    check (acquisition_source in ('facebook', 'whatsapp', 'in_person', 'other')),
  notes text check (notes is null or length(notes) <= 2000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_name_idx on public.customers (lower(name));
create index customers_phone_idx on public.customers (phone);
create trigger customers_set_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- sales / sale_items
-- ---------------------------------------------------------------------------
create sequence public.sale_number_seq;

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  sale_number text not null unique
    default ('V-' || lpad(nextval('public.sale_number_seq')::text, 6, '0')),
  customer_id uuid not null references public.customers (id) on delete restrict,
  modality text not null default 'cash' check (modality in ('cash', 'credit')),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  source text not null check (source in ('facebook', 'whatsapp', 'in_person', 'other')),
  total numeric(14, 2) not null default 0 check (total >= 0),
  notes text check (notes is null or length(notes) <= 2000),
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'confirmed') = (confirmed_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create index sales_customer_idx on public.sales (customer_id, created_at desc);
create index sales_status_idx on public.sales (status, created_at desc);
create trigger sales_set_updated_at before update on public.sales
  for each row execute function public.set_updated_at();

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete restrict,
  product_unit_id uuid references public.product_units (id) on delete restrict,
  product_variant_id uuid references public.product_variants (id) on delete restrict,
  description text not null,
  quantity integer not null check (quantity > 0),
  -- Precio y costo históricos: se copian al crear la venta y no cambian aunque cambie el catálogo.
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  unit_cost numeric(14, 2) not null check (unit_cost >= 0),
  created_at timestamptz not null default now(),
  check (num_nonnulls(product_unit_id, product_variant_id) = 1),
  check (product_unit_id is null or quantity = 1),
  unique (sale_id, product_unit_id),
  unique (sale_id, product_variant_id)
);
create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_unit_idx on public.sale_items (product_unit_id);

-- ---------------------------------------------------------------------------
-- payments (cobros). La aplicación a cuotas de crédito (payment_allocations) llega en la Fase 4.
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete restrict,
  method text not null check (method in ('cash', 'transfer')),
  amount numeric(14, 2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected', 'reversed')),
  reference text check (reference is null or length(trim(reference)) <= 100),
  status_reason text check (status_reason is null or length(status_reason) <= 500),
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users (id) on delete set null,
  status_changed_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- una transferencia debe tener clave de rastreo / referencia
  check (method <> 'transfer' or length(trim(coalesce(reference, ''))) >= 4)
);
create index payments_sale_idx on public.payments (sale_id);
-- La misma referencia de transferencia no puede usarse en dos pagos vigentes (pago duplicado).
create unique index payments_transfer_ref_idx on public.payments (lower(trim(reference)))
  where method = 'transfer' and status in ('pending', 'confirmed');
create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

-- Resumen por venta: dinero registrado vs dinero confirmado (nunca se mezclan).
create view public.sale_summaries with (security_invoker = true) as
select
  s.id, s.sale_number, s.customer_id, c.name as customer_name, s.modality, s.status, s.source,
  s.total, s.notes, s.cancel_reason, s.confirmed_at, s.cancelled_at, s.created_at,
  coalesce(sum(p.amount) filter (where p.status = 'confirmed'), 0)::numeric(14, 2) as confirmed_paid,
  coalesce(sum(p.amount) filter (where p.status = 'pending'), 0)::numeric(14, 2) as pending_paid
from public.sales s
join public.customers c on c.id = s.customer_id
left join public.payments p on p.sale_id = s.id
group by s.id, c.name;

-- ---------------------------------------------------------------------------
-- Funciones internas (no expuestas)
-- ---------------------------------------------------------------------------

-- Si los pagos confirmados cubren el total, confirma la venta y marca las unidades como vendidas.
create or replace function public.complete_sale_if_paid(p_sale_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  paid numeric(14, 2);
  it record;
begin
  select * into s from public.sales where id = p_sale_id for update;
  if s.status <> 'pending' then
    return false;
  end if;

  select coalesce(sum(amount), 0) into paid from public.payments
  where sale_id = p_sale_id and status = 'confirmed';
  if paid <> s.total then
    return false;
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
  values (auth.uid(), 'confirm_sale', 'sales', p_sale_id, jsonb_build_object('total', s.total));
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: crear una venta de contado (pendiente) y reservar inventario
-- p_items: [{"unit_id": uuid, "unit_price": "11000.00"?}, {"variant_id": uuid, "quantity": n, "unit_price": "299"?}]
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
  existing uuid;
  new_sale uuid;
  item record;
  u record;
  v record;
  pname text;
  price numeric(14, 2);
  qty integer;
  v_total numeric(14, 2) := 0;
begin
  perform public.assert_admin();

  select id into existing from public.sales where idempotency_key = p_idempotency_key;
  if existing is not null then
    return existing;
  end if;

  if p_source not in ('facebook', 'whatsapp', 'in_person', 'other') then
    raise exception 'Origen de venta inválido' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe incluir al menos un producto' using errcode = '22023';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id and is_active) then
    raise exception 'Cliente no encontrado o inactivo' using errcode = 'P0002';
  end if;

  begin
    insert into public.sales (customer_id, source, notes, idempotency_key)
    values (p_customer_id, p_source, nullif(trim(p_notes), ''), p_idempotency_key)
    returning id into new_sale;
  exception when unique_violation then
    -- Reintento simultáneo con la misma clave: se devuelve la venta ya creada.
    select id into existing from public.sales where idempotency_key = p_idempotency_key;
    if existing is not null then
      return existing;
    end if;
    raise;
  end;

  -- Se procesa en orden determinista para tomar los bloqueos siempre en el mismo orden (evita interbloqueos).
  for item in
    select value as j from jsonb_array_elements(p_items)
    order by coalesce(value ->> 'unit_id', value ->> 'variant_id')
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
      select name into pname from public.products where id = u.product_id;
      price := coalesce(nullif(item.j ->> 'unit_price', '')::numeric, u.sale_price);
      if price < 0 or price <> round(price, 2) then
        raise exception 'Precio inválido' using errcode = '22023';
      end if;
      insert into public.sale_items (sale_id, product_unit_id, description, quantity, unit_price, unit_cost)
      values (
        new_sale, u.id,
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
      if v.stock_quantity < qty then
        raise exception 'Existencias insuficientes de % (disponibles: %)', v.sku, v.stock_quantity using errcode = '23514';
      end if;
      select name into pname from public.products where id = v.product_id;
      price := coalesce(nullif(item.j ->> 'unit_price', '')::numeric, v.price);
      if price < 0 or price <> round(price, 2) then
        raise exception 'Precio inválido' using errcode = '22023';
      end if;
      insert into public.sale_items (sale_id, product_variant_id, description, quantity, unit_price, unit_cost)
      values (
        new_sale, v.id,
        pname || coalesce(' — ' || v.color, '') || coalesce(' (' || v.compatible_model || ')', '') || ' [' || v.sku || ']',
        qty, price, v.cost
      );
      update public.product_variants set stock_quantity = stock_quantity - qty where id = v.id;
      insert into public.inventory_movements (
        product_variant_id, movement_type, quantity_delta, stock_after, reason, idempotency_key
      ) values (
        v.id, 'exit', -qty, v.stock_quantity - qty, 'Venta pendiente',
        'sale:' || new_sale || ':variant:' || v.id
      );
      v_total := v_total + price * qty;
    end if;
  end loop;

  if v_total <= 0 then
    raise exception 'El total de la venta debe ser mayor a cero' using errcode = '22023';
  end if;
  update public.sales set total = v_total where id = new_sale;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'create_sale', 'sales', new_sale, jsonb_build_object('total', v_total, 'customer_id', p_customer_id));
  return new_sale;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: registrar un pago. Efectivo = confirmado; transferencia = pendiente de verificación.
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
  existing uuid;
  s record;
  committed numeric(14, 2);
  pay_id uuid;
begin
  perform public.assert_admin();

  select id into existing from public.payments where idempotency_key = p_idempotency_key;
  if existing is not null then
    return existing;
  end if;

  if p_method not in ('cash', 'transfer') then
    raise exception 'Método de pago inválido' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Importe inválido' using errcode = '22023';
  end if;

  select * into s from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venta no encontrada' using errcode = 'P0002';
  end if;
  if s.status <> 'pending' then
    raise exception 'Solo se registran pagos en ventas pendientes (estado: %)', s.status using errcode = '23514';
  end if;

  select coalesce(sum(amount), 0) into committed from public.payments
  where sale_id = p_sale_id and status in ('pending', 'confirmed');
  if committed + p_amount > s.total then
    raise exception 'El pago excede el saldo de la venta (saldo: %)', s.total - committed using errcode = '23514';
  end if;

  begin
    insert into public.payments (sale_id, method, amount, status, reference, confirmed_at, confirmed_by, status_changed_at, idempotency_key)
    values (
      p_sale_id, p_method, p_amount,
      case p_method when 'cash' then 'confirmed' else 'pending' end,
      nullif(trim(p_reference), ''),
      case p_method when 'cash' then now() end,
      case p_method when 'cash' then auth.uid() end,
      now(), p_idempotency_key
    ) returning id into pay_id;
  exception when unique_violation then
    select id into existing from public.payments where idempotency_key = p_idempotency_key;
    if existing is not null then
      return existing;
    end if;
    raise;
  end;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'record_payment', 'payments', pay_id,
    jsonb_build_object('sale_id', p_sale_id, 'method', p_method, 'amount', p_amount));

  if p_method = 'cash' then
    perform public.complete_sale_if_paid(p_sale_id);
  end if;
  return pay_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: confirmar una transferencia verificada. Idempotente por estado.
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
begin
  perform public.assert_admin();

  -- Orden de bloqueo: venta primero y pago después (igual que cancel_sale), para evitar interbloqueos.
  select sale_id into v_sale_id from public.payments where id = p_payment_id;
  if v_sale_id is null then
    raise exception 'Pago no encontrado' using errcode = 'P0002';
  end if;
  select status into s_status from public.sales where id = v_sale_id for update;
  select * into p from public.payments where id = p_payment_id for update;
  if p.status = 'confirmed' then
    return 'confirmed';
  end if;
  if p.status <> 'pending' then
    raise exception 'Solo se confirman pagos pendientes (estado: %)', p.status using errcode = '23514';
  end if;

  if s_status <> 'pending' then
    raise exception 'La venta ya no está pendiente (estado: %)', s_status using errcode = '23514';
  end if;

  update public.payments
  set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid(), status_changed_at = now()
  where id = p_payment_id;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'confirm_payment', 'payments', p_payment_id, jsonb_build_object('sale_id', p.sale_id, 'amount', p.amount));

  perform public.complete_sale_if_paid(p.sale_id);
  return 'confirmed';
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: rechazar un pago pendiente (la transferencia no se verificó)
-- ---------------------------------------------------------------------------
create or replace function public.reject_payment(p_payment_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  v_sale_id uuid;
begin
  perform public.assert_admin();
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'El motivo es obligatorio' using errcode = '22023';
  end if;

  select sale_id into v_sale_id from public.payments where id = p_payment_id;
  if v_sale_id is null then
    raise exception 'Pago no encontrado' using errcode = 'P0002';
  end if;
  perform 1 from public.sales where id = v_sale_id for update;
  select * into p from public.payments where id = p_payment_id for update;
  if p.status = 'rejected' then
    return 'rejected';
  end if;
  if p.status <> 'pending' then
    raise exception 'Solo se rechazan pagos pendientes (estado: %)', p.status using errcode = '23514';
  end if;

  update public.payments set status = 'rejected', status_reason = trim(p_reason), status_changed_at = now()
  where id = p_payment_id;
  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'reject_payment', 'payments', p_payment_id, jsonb_build_object('sale_id', p.sale_id, 'reason', trim(p_reason)));
  return 'rejected';
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: revertir un pago confirmado. El registro se conserva (estado 'reversed').
-- Solo mientras la venta siga pendiente; revertir sobre ventas confirmadas requiere política aprobada.
-- ---------------------------------------------------------------------------
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
  select * into p from public.payments where id = p_payment_id for update;
  if p.status = 'reversed' then
    return 'reversed';
  end if;
  if p.status <> 'confirmed' then
    raise exception 'Solo se revierten pagos confirmados (estado: %)', p.status using errcode = '23514';
  end if;

  if s_status <> 'pending' then
    raise exception 'Revertir un pago de una venta confirmada requiere una política aprobada por el negocio'
      using errcode = '0A000';
  end if;

  update public.payments set status = 'reversed', status_reason = trim(p_reason), status_changed_at = now()
  where id = p_payment_id;
  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'reverse_payment', 'payments', p_payment_id, jsonb_build_object('sale_id', p.sale_id, 'reason', trim(p_reason)));
  return 'reversed';
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: cancelar una venta pendiente y liberar el inventario
-- ---------------------------------------------------------------------------
create or replace function public.cancel_sale(p_sale_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
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
  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'cancel_sale', 'sales', p_sale_id, jsonb_build_object('reason', trim(p_reason)));
  return 'cancelled';
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilegios y RLS
-- ---------------------------------------------------------------------------
revoke all on function public.complete_sale_if_paid(uuid) from public;
revoke all on function public.create_sale(uuid, text, jsonb, text, text) from public;
revoke all on function public.record_payment(uuid, text, numeric, text, text) from public;
revoke all on function public.confirm_payment(uuid) from public;
revoke all on function public.reject_payment(uuid, text) from public;
revoke all on function public.reverse_payment(uuid, text) from public;
revoke all on function public.cancel_sale(uuid, text) from public;
grant execute on function public.create_sale(uuid, text, jsonb, text, text) to authenticated;
grant execute on function public.record_payment(uuid, text, numeric, text, text) to authenticated;
grant execute on function public.confirm_payment(uuid) to authenticated;
grant execute on function public.reject_payment(uuid, text) to authenticated;
grant execute on function public.reverse_payment(uuid, text) to authenticated;
grant execute on function public.cancel_sale(uuid, text) to authenticated;

revoke all on public.customers, public.sales, public.sale_items, public.payments, public.sale_summaries
  from anon, authenticated;
grant select, insert, update, delete on public.customers to authenticated;
grant select on public.sales, public.sale_items, public.payments, public.sale_summaries to authenticated;

alter table public.customers enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;

create policy customers_admin on public.customers for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy sales_admin_select on public.sales for select to authenticated
  using ((select public.is_admin()));
create policy sale_items_admin_select on public.sale_items for select to authenticated
  using ((select public.is_admin()));
create policy payments_admin_select on public.payments for select to authenticated
  using ((select public.is_admin()));
