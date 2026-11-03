-- Correcciones tras la revisión adversarial de créditos (Opus):
--  M1 cuotas mínimas, M2 saldo de créditos cancelados, B1 precios con >2 decimales, B2 huella estable,
--  B3/B7 idempotencia completa, B4 fecha acotada, B5 coherencia de estados, B6 orden de bloqueo.

alter table public.credits
  add constraint credits_settled_coherent check ((status = 'settled') = (settled_at is not null)),
  add constraint credits_cancelled_coherent check ((status = 'cancelled') = (cancelled_at is not null));

create or replace function public.check_payment_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  m text;
begin
  select modality into m from public.sales where id = new.sale_id;
  if (new.kind = 'sale' and m <> 'cash') or (new.kind <> 'sale' and m <> 'credit') then
    raise exception 'El tipo de pago (%) no corresponde a la modalidad de la venta (%)', new.kind, m using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_payment_kind() from public, anon, authenticated;
create trigger payments_kind_matches_modality before insert on public.payments
  for each row execute function public.check_payment_kind();

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
  raw numeric;
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
      raw := nullif(item.j ->> 'unit_price', '')::numeric;
      if raw is not null and (raw = 'NaN'::numeric or raw < 0 or raw <> round(raw, 2)) then
        raise exception 'Precio inválido (máximo 2 decimales)' using errcode = '22023';
      end if;
      price := coalesce(raw, u.sale_price);
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
      raw := nullif(item.j ->> 'unit_price', '')::numeric;
      if raw is not null and (raw = 'NaN'::numeric or raw < 0 or raw <> round(raw, 2)) then
        raise exception 'Precio inválido (máximo 2 decimales)' using errcode = '22023';
      end if;
      price := coalesce(raw, v.price);
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
  -- Orden de bloqueo declarado: venta primero (no depender de quien llama).
  perform 1 from public.sales where id = (select sale_id from public.credits where id = p_credit_id) for update;
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
  if p_first_due_date is null or p_first_due_date < today or p_first_due_date > today + 365 then
    raise exception 'La primera fecha de pago debe estar entre hoy y un año' using errcode = '22023';
  end if;
  if round((p_financed_total - p_down_payment) * 100) < p_installments then
    raise exception 'El saldo a financiar es demasiado pequeño para ese número de cuotas (mínimo 0.01 por cuota)' using errcode = '22023';
  end if;

  v_hash := md5(
    p_customer_id::text || '|' || p_source || '|' || round(p_financed_total, 2)::text || '|' || round(p_down_payment, 2)::text || '|' ||
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
    if existing.sale_id <> p_sale_id or existing.method <> p_method or existing.amount <> p_amount or existing.kind <> 'sale' then
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
    if existing.sale_id <> p_sale_id or existing.method <> p_method or existing.amount <> p_amount or existing.kind <> 'sale' then
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
    if existing.sale_id <> v_sale_id or existing.method <> p_method or existing.amount <> p_amount or existing.kind <> p_kind
         or existing.reference is distinct from nullif(trim(p_reference), '') then
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
      if existing.sale_id <> v_sale_id or existing.method <> p_method or existing.amount <> p_amount or existing.kind <> p_kind
         or existing.reference is distinct from nullif(trim(p_reference), '') then
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

create or replace view public.credit_summaries with (security_invoker = true) as
select
  c.id, c.credit_number, c.sale_id, c.customer_id, cu.name as customer_name, s.sale_number,
  c.status, c.financed_total, c.down_payment, c.principal, c.frequency, c.installments_count,
  c.first_due_date, c.notes, c.created_at, c.settled_at, c.cancelled_at,
  coalesce(dp.paid, 0)::numeric(14, 2) as down_paid,
  coalesce(al.paid, 0)::numeric(14, 2) as installments_paid,
  (case when c.status = 'cancelled' then 0 else c.principal - coalesce(al.paid, 0) end)::numeric(14, 2) as balance,
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
  where st.credit_id = c.id and st.remaining > 0 and c.status = 'active'
) nx on true;
