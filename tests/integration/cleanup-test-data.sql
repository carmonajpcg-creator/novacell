-- Limpia los datos de prueba reales creados por las pruebas E2E (prefijo "E2E ") y de concurrencia (prefijo "CC ").
-- Solo para entornos de desarrollo. Deshabilita temporalmente el trigger de solo-inserción de movimientos.
do $$
declare pids uuid[]; uids uuid[]; vids uuid[]; cids uuid[]; sids uuid[]; crids uuid[];
begin
  select coalesce(array_agg(id), '{}') into pids from public.products where name like 'E2E %' or name like 'CC %';
  select coalesce(array_agg(id), '{}') into uids from public.product_units where product_id = any(pids);
  select coalesce(array_agg(id), '{}') into vids from public.product_variants where product_id = any(pids);
  select coalesce(array_agg(id), '{}') into cids from public.customers where name like 'E2E %' or name like 'CC %';
  select coalesce(array_agg(id), '{}') into sids from public.sales where customer_id = any(cids);

  select coalesce(array_agg(id), '{}') into crids from public.credits where sale_id = any(sids);
  delete from public.payment_allocations where payment_id in (select id from public.payments where sale_id = any(sids));
  delete from public.installments where credit_id = any(crids);
  delete from public.credits where id = any(crids);
  delete from public.payments where sale_id = any(sids);
  delete from public.sale_items where sale_id = any(sids);
  delete from public.sales where id = any(sids);
  delete from public.customers where id = any(cids);

  alter table public.inventory_movements disable trigger inventory_movements_append_only;
  delete from public.inventory_movements where product_unit_id = any(uids) or product_variant_id = any(vids);
  alter table public.inventory_movements enable trigger inventory_movements_append_only;

  delete from public.audit_logs where (entity = 'product_units' and entity_id = any(uids))
    or (entity = 'sales' and entity_id = any(sids))
    or (entity = 'credits' and entity_id = any(crids))
    or (entity = 'payments' and (details ->> 'sale_id')::uuid = any(sids));
  delete from public.product_images where product_id = any(pids);
  delete from public.product_units where id = any(uids);
  delete from public.product_variants where id = any(vids);
  delete from public.products where id = any(pids);
  delete from public.categories where name like 'E2E %' or name like 'CC %';
end $$;
