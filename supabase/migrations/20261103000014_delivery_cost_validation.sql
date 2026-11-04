-- Corrección: un costo de entrega con más de 2 decimales se redondeaba en silencio antes de validarse.

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
