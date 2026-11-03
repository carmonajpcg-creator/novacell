-- Endurecimiento tras la revisión adversarial de la Fase 3.
--  1. Privilegios EXECUTE: Supabase concede EXECUTE a anon/authenticated por defecto; "revoke from public" no basta.
--  2. NaN en columnas NUMERIC (pasa >= 0 y cabe en NUMERIC(14,2)).
--  3. Idempotencia: la misma clave con datos distintos es un error, y el reintento simultáneo devuelve la operación original.
--  4. Coherencia de estados, productos inactivos, orden de bloqueos y auditoría de precios distintos al catálogo.

-- ---------------------------------------------------------------------------
-- 1. Privilegios de funciones
-- ---------------------------------------------------------------------------
-- Las funciones nuevas ya no heredan EXECUTE para anon/authenticated: cada migración debe concederlo explícitamente.
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

-- Funciones internas: nadie desde el cliente (las invocan las funciones SECURITY DEFINER como propietario).
revoke execute on function public.assert_admin() from anon, authenticated;
revoke execute on function public.complete_sale_if_paid(uuid) from anon, authenticated;
revoke execute on function public.set_updated_at() from anon, authenticated;
revoke execute on function public.enforce_product_kind() from anon, authenticated;
revoke execute on function public.block_movement_changes() from anon, authenticated;

-- RPC: solo usuarios autenticados (y dentro de la función se exige ser admin).
revoke execute on function public.register_unit(uuid, text, text, integer, text, text, text, integer, numeric, numeric, text, text) from anon;
revoke execute on function public.set_unit_active(uuid, boolean, text, text) from anon;
revoke execute on function public.adjust_variant_stock(uuid, text, integer, text, text) from anon;
revoke execute on function public.create_sale(uuid, text, jsonb, text, text) from anon;
revoke execute on function public.record_payment(uuid, text, numeric, text, text) from anon;
revoke execute on function public.confirm_payment(uuid) from anon;
revoke execute on function public.reject_payment(uuid, text) from anon;
revoke execute on function public.reverse_payment(uuid, text) from anon;
revoke execute on function public.cancel_sale(uuid, text) from anon;
-- is_admin() lo evalúan las políticas RLS con el rol de la consulta: se conserva para authenticated.
revoke execute on function public.is_admin() from anon;

-- Las secuencias solo las usan las funciones definer.
revoke all on all sequences in schema public from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. NaN y coherencia de estados
-- ---------------------------------------------------------------------------
alter table public.product_variants
  add constraint product_variants_price_not_nan check (price <> 'NaN'::numeric),
  add constraint product_variants_cost_not_nan check (cost <> 'NaN'::numeric);
alter table public.product_units
  add constraint product_units_cost_not_nan check (acquisition_cost <> 'NaN'::numeric),
  add constraint product_units_price_not_nan check (sale_price <> 'NaN'::numeric);
alter table public.sales
  add constraint sales_total_not_nan check (total <> 'NaN'::numeric);
alter table public.sale_items
  add constraint sale_items_price_not_nan check (unit_price <> 'NaN'::numeric),
  add constraint sale_items_cost_not_nan check (unit_cost <> 'NaN'::numeric);
alter table public.payments
  add constraint payments_amount_not_nan check (amount <> 'NaN'::numeric),
  add constraint payments_confirmed_has_date check (status <> 'confirmed' or confirmed_at is not null),
  add constraint payments_closed_has_reason check (status not in ('rejected', 'reversed') or status_reason is not null);

-- Huella de la solicitud para detectar la reutilización de una clave de idempotencia con otros datos.
alter table public.sales add column request_hash text;

-- ---------------------------------------------------------------------------
-- 3. Funciones corregidas
-- ---------------------------------------------------------------------------
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
  if not found then
    raise exception 'Venta no encontrada' using errcode = 'P0002';
  end if;
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
  item record;
  u record;
  v record;
  pname text;
  pactive boolean;
  price numeric(14, 2);
  qty integer;
  v_total numeric(14, 2) := 0;
  v_hash text;
  overrides jsonb := '[]'::jsonb;
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
    -- Reintento simultáneo con la misma clave: se devuelve la venta ya creada (si los datos coinciden).
    select id, request_hash into existing from public.sales where idempotency_key = p_idempotency_key;
    if found then
      if existing.request_hash is distinct from v_hash then
        raise exception 'La clave de idempotencia ya se usó con otros datos' using errcode = '23505';
      end if;
      return existing.id;
    end if;
    raise;
  end;

  -- Orden determinista de bloqueos (por UUID, igual que cancel_sale/complete_sale_if_paid) para evitar interbloqueos.
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
  values (auth.uid(), 'create_sale', 'sales', new_sale,
    jsonb_build_object('total', v_total, 'customer_id', p_customer_id, 'price_overrides', overrides));
  return new_sale;
end;
$$;

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

  -- Con la venta bloqueada se revisa de nuevo: un reintento simultáneo pudo haber registrado ya este pago.
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
  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'cancel_sale', 'sales', p_sale_id, jsonb_build_object('reason', trim(p_reason)));
  return 'cancelled';
end;
$$;

-- Inventario (Fase 2): misma protección contra clave de idempotencia reutilizada con otros datos.
create or replace function public.register_unit(
  p_product_id uuid,
  p_imei text,
  p_serial_number text,
  p_storage_gb integer,
  p_color text,
  p_condition text,
  p_physical_grade text,
  p_battery_health integer,
  p_acquisition_cost numeric,
  p_sale_price numeric,
  p_notes text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_unit uuid;
  existing_imei text;
  new_id uuid;
begin
  perform public.assert_admin();

  select m.product_unit_id, u.imei into existing_unit, existing_imei
  from public.inventory_movements m join public.product_units u on u.id = m.product_unit_id
  where m.idempotency_key = p_idempotency_key;
  if existing_unit is not null then
    if existing_imei <> p_imei then
      raise exception 'La clave de idempotencia ya se usó con otros datos' using errcode = '23505';
    end if;
    return existing_unit;
  end if;

  insert into public.product_units (
    product_id, imei, serial_number, storage_gb, color, condition, physical_grade,
    battery_health, acquisition_cost, sale_price, notes
  ) values (
    p_product_id, p_imei, nullif(trim(p_serial_number), ''), p_storage_gb, p_color, p_condition,
    nullif(trim(p_physical_grade), ''), p_battery_health, p_acquisition_cost, p_sale_price,
    nullif(trim(p_notes), '')
  ) returning id into new_id;

  insert into public.inventory_movements (product_unit_id, movement_type, quantity_delta, reason, idempotency_key)
  values (new_id, 'entry', 1, 'Alta de unidad', p_idempotency_key);

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'register_unit', 'product_units', new_id, jsonb_build_object('product_id', p_product_id));

  return new_id;
end;
$$;

create or replace function public.adjust_variant_stock(
  p_variant_id uuid,
  p_type text,
  p_delta integer,
  p_reason text,
  p_idempotency_key text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior integer;
  new_stock integer;
  existing record;
begin
  perform public.assert_admin();

  select * into existing from public.inventory_movements where idempotency_key = p_idempotency_key;
  if found then
    if existing.product_variant_id is distinct from p_variant_id
       or existing.movement_type <> p_type or existing.quantity_delta <> p_delta then
      raise exception 'La clave de idempotencia ya se usó con otros datos' using errcode = '23505';
    end if;
    return existing.stock_after;
  end if;

  if p_type not in ('entry', 'exit', 'adjustment') then
    raise exception 'Tipo de movimiento inválido' using errcode = '22023';
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception 'La cantidad no puede ser cero' using errcode = '22023';
  end if;

  select stock_quantity into prior from public.product_variants where id = p_variant_id for update;
  if prior is null then
    raise exception 'Variante no encontrada' using errcode = 'P0002';
  end if;

  new_stock := prior + p_delta;
  if new_stock < 0 then
    raise exception 'Existencias insuficientes (disponibles: %)', prior using errcode = '23514';
  end if;

  insert into public.inventory_movements (
    product_variant_id, movement_type, quantity_delta, stock_after, reason, idempotency_key
  ) values (p_variant_id, p_type, p_delta, new_stock, p_reason, p_idempotency_key);

  update public.product_variants set stock_quantity = new_stock where id = p_variant_id;
  return new_stock;
end;
$$;
