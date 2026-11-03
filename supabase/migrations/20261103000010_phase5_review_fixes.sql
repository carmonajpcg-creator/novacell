-- Correcciones tras la revisión adversarial de la Fase 5 (Opus):
--  M1 cancelar con pagos pendientes de verificar, M2 validación del anticipo mínimo, BAJO 1 pendiente de verificar en la cola,
--  BAJO 2 recordatorios sobre apartados/créditos no vigentes, BAJO 3 seguimiento inmutable, BAJO 4 huella con notas,
--  y cierre del hueco 'revertir y luego cancelar' mientras no exista política de devolución/retención (L8).

-- Validación de ajustes con efecto en reglas comerciales (un valor erróneo no debe romper ni relajar las reglas).
create or replace function public.validate_business_setting()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.key = 'layaway_min_down_percent' then
    if jsonb_typeof(new.value) <> 'number' then
      raise exception 'layaway_min_down_percent debe ser un número entre 0 y 100' using errcode = '22023';
    end if;
    if (new.value #>> '{}')::numeric < 0 or (new.value #>> '{}')::numeric > 100 then
      raise exception 'layaway_min_down_percent debe estar entre 0 y 100' using errcode = '22023';
    end if;
  elsif new.key = 'credit_allowed_frequencies' then
    if jsonb_typeof(new.value) <> 'array' or jsonb_array_length(new.value) = 0
       or exists (select 1 from jsonb_array_elements_text(new.value) f where f not in ('weekly', 'biweekly', 'monthly')) then
      raise exception 'credit_allowed_frequencies debe ser una lista no vacía de weekly, biweekly o monthly' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_business_setting() from public, anon, authenticated;
create trigger business_settings_validate before insert or update on public.business_settings
  for each row execute function public.validate_business_setting();

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
  raw jsonb;
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
    p_customer_id::text || '|' || p_source || '|' || round(p_down_payment, 2)::text || '|' || p_due_date::text || '|' || coalesce(trim(p_notes), '') || '|' ||
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
  select value into raw from public.business_settings where key = 'layaway_min_down_percent';
  if raw is not null and jsonb_typeof(raw) <> 'null' then
    if jsonb_typeof(raw) <> 'number' then
      raise exception 'Configuración inválida: layaway_min_down_percent' using errcode = '22023';
    end if;
    minpct := (raw #>> '{}')::numeric;
    if minpct < 0 or minpct > 100 then
      raise exception 'Configuración inválida: layaway_min_down_percent' using errcode = '22023';
    end if;
    if p_down_payment * 100 < v_total * minpct then
      raise exception 'El anticipo mínimo es el % por ciento del total', minpct using errcode = '23514';
    end if;
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
  -- Apartado con pagos cobrados o revertidos: devolución o retención del anticipo = política no definida
  -- (CLAUDE.md §11). Se incluyen los revertidos para que "revertir y luego cancelar" no evada el bloqueo.
  if l.id is not null and exists (select 1 from public.payments where sale_id = p_sale_id and status in ('confirmed', 'reversed')) then
    raise exception 'Cancelar un apartado con pagos cobrados o revertidos requiere una política de devolución o retención de anticipos aprobada por el negocio'
      using errcode = '0A000';
  end if;
  if exists (select 1 from public.payments where sale_id = p_sale_id and status = 'confirmed') then
    raise exception 'Revierte primero los pagos confirmados de esta venta' using errcode = '23514';
  end if;
  -- Un pago pendiente puede corresponder a dinero ya recibido: debe confirmarse o rechazarse de forma explícita.
  if (l.id is not null or c.id is not null) and exists (select 1 from public.payments where sale_id = p_sale_id and status = 'pending') then
    raise exception 'Confirma o rechaza primero los pagos pendientes de verificación' using errcode = '23514';
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
    p_frequency || '|' || p_installments::text || '|' || p_first_due_date::text || '|' || coalesce(trim(p_notes), '') || '|' ||
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

create or replace function public.collection_reminders_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  owner uuid;
  ostatus text;
begin
  if tg_op = 'INSERT' then
    if new.installment_id is not null then
      select c.customer_id, c.status into owner, ostatus
      from public.installments i join public.credits c on c.id = i.credit_id where i.id = new.installment_id;
      if ostatus is distinct from 'active' then
        raise exception 'Solo se preparan recordatorios para cuotas de créditos activos' using errcode = '23514';
      end if;
    elsif new.layaway_id is not null then
      select customer_id, status into owner, ostatus from public.layaways where id = new.layaway_id;
      if ostatus is null or ostatus not in ('pending_down', 'active') then
        raise exception 'Solo se preparan recordatorios para apartados vigentes' using errcode = '23514';
      end if;
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
  -- Un contacto registrado es parte del historial: una corrección se registra como un recordatorio nuevo.
  if old.status = 'contacted' and (new.outcome is distinct from old.outcome
     or new.promised_date is distinct from old.promised_date or new.note is distinct from old.note) then
    raise exception 'El resultado de un contacto registrado no se modifica; registra un nuevo seguimiento' using errcode = '23514';
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

-- Cola de cobranza con lo pendiente de verificar (para no reclamar un pago que el cliente ya hizo).
drop view public.collection_queue;
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
    coalesce((
      select sum(p.amount) from public.payments p
      where p.sale_id = c.sale_id and p.status = 'pending' and p.kind in ('installment', 'down_payment')
    ), 0)::numeric(14, 2) as pending_verification,
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
    ls.pending_verification,
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

revoke all on public.collection_queue from anon, authenticated;
grant select on public.collection_queue to authenticated;
