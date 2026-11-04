-- Fase 8: endurecimiento previo al lanzamiento (revisión de seguridad con Opus).

-- B1. Las funciones nuevas ya no heredan EXECUTE para PUBLIC (Postgres lo concede por defecto).
alter default privileges for role postgres in schema public revoke execute on functions from public;

-- B5. La bitácora solo la escriben las funciones del sistema (definer) y los triggers: el admin ya no inserta a mano.
drop policy if exists audit_admin_insert on public.audit_logs;
revoke insert on public.audit_logs from authenticated;

-- M3. IMEI, serie, costo y precio de una unidad: no se cambian si está reservada o vendida, y todo cambio queda en bitácora.
create or replace function public.guard_unit_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.imei is distinct from old.imei
     or new.serial_number is distinct from old.serial_number
     or new.acquisition_cost is distinct from old.acquisition_cost
     or new.sale_price is distinct from old.sale_price then
    if old.status in ('reserved', 'sold') then
      raise exception 'No se pueden cambiar IMEI, serie, costo ni precio de una unidad reservada o vendida'
        using errcode = '23514';
    end if;
    insert into public.audit_logs (actor_id, action, entity, entity_id, details)
    values (auth.uid(), 'update_unit_identity', 'product_units', old.id, jsonb_build_object(
      'imei', jsonb_build_object('from', old.imei, 'to', new.imei),
      'serial_changed', new.serial_number is distinct from old.serial_number,
      'acquisition_cost', jsonb_build_object('from', old.acquisition_cost, 'to', new.acquisition_cost),
      'sale_price', jsonb_build_object('from', old.sale_price, 'to', new.sale_price)));
  end if;
  return new;
end;
$$;
revoke all on function public.guard_unit_identity() from public, anon, authenticated;

drop trigger if exists product_units_guard_identity on public.product_units;
create trigger product_units_guard_identity before update on public.product_units
  for each row execute function public.guard_unit_identity();

-- Cambios de precio o costo de una variante de accesorio: quedan en bitácora (las ventas ya copian su precio histórico).
create or replace function public.audit_variant_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.price is distinct from old.price or new.cost is distinct from old.cost then
    insert into public.audit_logs (actor_id, action, entity, entity_id, details)
    values (auth.uid(), 'update_variant_price', 'product_variants', old.id, jsonb_build_object(
      'price', jsonb_build_object('from', old.price, 'to', new.price),
      'cost', jsonb_build_object('from', old.cost, 'to', new.cost)));
  end if;
  return new;
end;
$$;
revoke all on function public.audit_variant_price() from public, anon, authenticated;

drop trigger if exists product_variants_audit_price on public.product_variants;
create trigger product_variants_audit_price after update on public.product_variants
  for each row execute function public.audit_variant_price();
