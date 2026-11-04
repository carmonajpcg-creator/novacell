-- Pruebas de la Fase 8: identidad de unidades protegida y auditada, y bitácora solo escrita por el sistema.
do $test$
declare
  admin_id uuid := '00000000-0000-0000-0000-0000000000a1';
  report text := '';
  fails int := 0;
  c boolean;
  cat_ip uuid; cat_ac uuid; prod_ac uuid; prod_ip uuid; unit_a uuid; unit_b uuid; cust uuid; s1 uuid; var_id uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (admin_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin8@test.local');
  insert into public.profiles (id, role) values (admin_id, 'admin');
  insert into public.categories (name, slug, kind) values ('T8 iPhone', 't8-iphone', 'iphone') returning id into cat_ip;
  insert into public.products (category_id, kind, name, slug) values (cat_ip, 'iphone', 'iPhone 8P', 't8-ip') returning id into prod_ip;
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price)
    values (prod_ip, '490154203237518', 256, 'Negro', 'used', 6000, 10000) returning id into unit_a;
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price)
    values (prod_ip, '352099001761481', 128, 'Azul', 'new', 12000, 15000) returning id into unit_b;
  insert into public.categories (name, slug, kind) values ('T8 Acc', 't8-acc', 'accessory') returning id into cat_ac;
  insert into public.products (category_id, kind, name, slug) values (cat_ac, 'accessory', 'Funda 8', 't8-fun') returning id into prod_ac;
  insert into public.product_variants (product_id, sku, color, price, cost) values (prod_ac, 'T8-SKU', 'Rojo', 100, 30) returning id into var_id;
  insert into public.customers (name, phone) values ('Cliente F8', '5512345678') returning id into cust;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);

  -- Unidad disponible: se puede corregir y queda auditado
  update public.product_units set imei = '356938035643809', acquisition_cost = 6500 where id = unit_a;
  c := exists (select 1 from public.audit_logs where entity = 'product_units' and entity_id = unit_a and action = 'update_unit_identity'
               and details -> 'imei' ->> 'from' = '490154203237518' and details -> 'imei' ->> 'to' = '356938035643809');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'corregir IMEI/costo de una unidad disponible queda en la bitacora (antes y despues)' || E'\n'; fails := fails + (not c)::int;

  -- Un cambio que no toca la identidad no genera auditoria de identidad
  update public.product_units set notes = 'nota' where id = unit_a;
  c := (select count(*) from public.audit_logs where entity_id = unit_a and action = 'update_unit_identity') = 1;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'editar notas no genera auditoria de identidad' || E'\n'; fails := fails + (not c)::int;

  -- Unidad reservada (venta pendiente): intocable
  s1 := public.create_sale(cust, 'whatsapp', jsonb_build_array(jsonb_build_object('unit_id', unit_b)), null, 'key-f8-sale');
  begin update public.product_units set imei = '490154203237526' where id = unit_b; c := false; exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se cambia el IMEI de una unidad reservada' || E'\n'; fails := fails + (not c)::int;
  begin update public.product_units set sale_price = 1 where id = unit_b; c := false; exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se cambia el precio de una unidad reservada' || E'\n'; fails := fails + (not c)::int;
  perform public.record_payment(s1, 'cash', 15000, null, 'key-f8-pay');
  begin update public.product_units set acquisition_cost = 1 where id = unit_b; c := false; exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se cambia el costo de una unidad vendida' || E'\n'; fails := fails + (not c)::int;
  c := (select status from public.product_units where id = unit_b) = 'sold';
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'las funciones de venta siguen cambiando el estado (el trigger no estorba)' || E'\n'; fails := fails + (not c)::int;

  -- Variantes
  update public.product_variants set price = 120 where id = var_id;
  c := exists (select 1 from public.audit_logs where entity = 'product_variants' and entity_id = var_id and action = 'update_variant_price'
               and (details -> 'price' ->> 'from')::numeric = 100 and (details -> 'price' ->> 'to')::numeric = 120);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cambiar el precio de una variante queda en la bitacora' || E'\n'; fails := fails + (not c)::int;

  -- Bitácora
  begin insert into public.audit_logs (actor_id, action, entity) values (admin_id, 'x', 'y'); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el admin no inserta en la bitacora a mano' || E'\n'; fails := fails + (not c)::int;
  begin perform public.guard_unit_identity(); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'las funciones de trigger no son ejecutables por el usuario' || E'\n'; fails := fails + (not c)::int;
  reset role;

  raise exception 'TESTS_DONE failures=% %', fails, E'\n' || report;
end;
$test$;
