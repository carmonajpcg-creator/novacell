-- Pruebas de la Fase 3: ventas, inventario, pagos, reversos y permisos.
-- Un solo bloque DO que revierte todo (ver tests/integration/run-db-tests.mjs).
do $test$
declare
  admin_id uuid := '00000000-0000-0000-0000-0000000000a1';
  emp_id uuid := '00000000-0000-0000-0000-0000000000b2';
  report text := '';
  fails int := 0;
  c boolean;
  n int;
  t text;
  cat_ip uuid; cat_ac uuid; prod_ip uuid; prod_ac uuid; var_id uuid; unit_a uuid; unit_b uuid; cust uuid;
  s1 uuid; s1b uuid; s2 uuid; s3 uuid; s4 uuid; p_cash uuid; p_tr uuid; p_tr2 uuid; p_rev uuid;
  sm record;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (admin_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
    (emp_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'emp@test.local');
  insert into public.profiles (id, role) values (admin_id, 'admin'), (emp_id, 'employee');
  insert into public.categories (name, slug, kind) values ('T iPhone', 't-iphone', 'iphone') returning id into cat_ip;
  insert into public.categories (name, slug, kind) values ('T Fundas', 't-fundas', 'accessory') returning id into cat_ac;
  insert into public.products (category_id, kind, name, slug) values (cat_ip, 'iphone', 'iPhone 15 Pro', 't-ip') returning id into prod_ip;
  insert into public.products (category_id, kind, name, slug) values (cat_ac, 'accessory', 'Funda', 't-fun') returning id into prod_ac;
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price)
    values (prod_ip, '490154203237518', 256, 'Negro', 'used', 8000, 11000) returning id into unit_a;
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price)
    values (prod_ip, '352099001761481', 128, 'Azul', 'new', 12000, 15000) returning id into unit_b;
  insert into public.product_variants (product_id, sku, color, price, cost, stock_quantity)
    values (prod_ac, 'T-FUN-1', 'Negro', 299, 90, 5) returning id into var_id;
  insert into public.customers (name, phone) values ('Cliente Prueba', '5512345678') returning id into cust;

  -- ===== Clientes: validación =====
  begin insert into public.customers (name, phone) values ('X', '123'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'telefono invalido es rechazado' || E'\n'; fails := fails + (not c)::int;

  -- ===== Administrador =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);

  s1 := public.create_sale(cust, 'whatsapp',
    jsonb_build_array(jsonb_build_object('unit_id', unit_a, 'unit_price', '10000.00'),
                      jsonb_build_object('variant_id', var_id, 'quantity', 2)),
    'nota', 'key-sale-0001');
  select * into sm from public.sale_summaries where id = s1;
  c := (sm.status = 'pending' and sm.total = 10598.00 and sm.confirmed_paid = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'crear venta: pendiente y total calculado en backend (10598.00)' || E'\n'; fails := fails + (not c)::int;
  c := ((select status from public.product_units where id = unit_a) = 'reserved'
        and (select stock_quantity from public.product_variants where id = var_id) = 3);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la venta reserva el iPhone y descuenta el accesorio' || E'\n'; fails := fails + (not c)::int;
  c := ((select unit_cost from public.sale_items where sale_id = s1 and product_unit_id = unit_a) = 8000
        and (select unit_price from public.sale_items where sale_id = s1 and product_unit_id = unit_a) = 10000
        and (select unit_cost from public.sale_items where sale_id = s1 and product_variant_id = var_id) = 90);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'se guardan precio y costo historicos' || E'\n'; fails := fails + (not c)::int;

  s1b := public.create_sale(cust, 'whatsapp',
    jsonb_build_array(jsonb_build_object('unit_id', unit_a, 'unit_price', '10000.00'),
                      jsonb_build_object('variant_id', var_id, 'quantity', 2)),
    'nota', 'key-sale-0001');
  select count(*) into n from public.sales;
  c := (s1b = s1 and n = 1 and (select stock_quantity from public.product_variants where id = var_id) = 3);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'reintento con la misma clave no duplica la venta ni el descuento' || E'\n'; fails := fails + (not c)::int;

  begin perform public.create_sale(cust, 'in_person', jsonb_build_array(jsonb_build_object('unit_id', unit_a)), null, 'key-sale-0002'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se vende una unidad reservada' || E'\n'; fails := fails + (not c)::int;

  begin perform public.create_sale(cust, 'in_person',
      jsonb_build_array(jsonb_build_object('unit_id', unit_b), jsonb_build_object('variant_id', var_id, 'quantity', 99)), null, 'key-sale-0003'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'existencias insuficientes rechazan la venta' || E'\n'; fails := fails + (not c)::int;
  c := ((select status from public.product_units where id = unit_b) = 'available'
        and (select stock_quantity from public.product_variants where id = var_id) = 3
        and (select count(*) from public.sales) = 1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una venta rechazada no deja reservas parciales (atomica)' || E'\n'; fails := fails + (not c)::int;

  begin perform public.create_sale(cust, 'in_person', jsonb_build_array(jsonb_build_object('unit_id', unit_b), jsonb_build_object('unit_id', unit_b)), null, 'key-sale-0004'); c := false;
  exception when others then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la misma unidad dos veces en una venta es rechazada' || E'\n'; fails := fails + (not c)::int;

  -- ===== Pagos =====
  begin perform public.record_payment(s1, 'cash', 20000, null, 'key-pay-0001'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se puede cobrar mas que el total' || E'\n'; fails := fails + (not c)::int;
  begin perform public.record_payment(s1, 'transfer', 100, null, 'key-pay-0002'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una transferencia exige clave de rastreo' || E'\n'; fails := fails + (not c)::int;

  p_cash := public.record_payment(s1, 'cash', 598, null, 'key-pay-0003');
  c := (p_cash = public.record_payment(s1, 'cash', 598, null, 'key-pay-0003')
        and (select count(*) from public.payments where sale_id = s1) = 1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'pago duplicado (misma clave) no se registra dos veces' || E'\n'; fails := fails + (not c)::int;
  select * into sm from public.sale_summaries where id = s1;
  c := (sm.status = 'pending' and sm.confirmed_paid = 598 and (select status from public.product_units where id = unit_a) = 'reserved');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un pago parcial no confirma la venta' || E'\n'; fails := fails + (not c)::int;

  p_tr := public.record_payment(s1, 'transfer', 10000, 'CLAVE-12345', 'key-pay-0004');
  select * into sm from public.sale_summaries where id = s1;
  c := (sm.confirmed_paid = 598 and sm.pending_paid = 10000 and sm.status = 'pending');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una transferencia pendiente NO cuenta como cobrada' || E'\n'; fails := fails + (not c)::int;

  t := public.confirm_payment(p_tr);
  select * into sm from public.sale_summaries where id = s1;
  c := (t = 'confirmed' and sm.status = 'confirmed' and sm.confirmed_paid = 10598 and sm.confirmed_at is not null);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'confirmar el pago que cubre el total confirma la venta' || E'\n'; fails := fails + (not c)::int;
  c := ((select status from public.product_units where id = unit_a) = 'sold'
        and (select count(*) from public.inventory_movements where product_unit_id = unit_a and movement_type = 'exit') = 1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'vender un iPhone lo marca vendido y registra la salida' || E'\n'; fails := fails + (not c)::int;
  t := public.confirm_payment(p_tr);
  c := (t = 'confirmed' and (select count(*) from public.inventory_movements where product_unit_id = unit_a and movement_type = 'exit') = 1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'confirmar dos veces es idempotente' || E'\n'; fails := fails + (not c)::int;

  begin perform public.create_sale(cust, 'in_person', jsonb_build_array(jsonb_build_object('unit_id', unit_a)), null, 'key-sale-0005'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se puede vender dos veces el mismo equipo' || E'\n'; fails := fails + (not c)::int;
  begin perform public.record_payment(s1, 'cash', 1, null, 'key-pay-0005'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se registran pagos en una venta confirmada' || E'\n'; fails := fails + (not c)::int;
  begin perform public.reverse_payment(p_cash, 'prueba'); c := false;
  exception when feature_not_supported then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'revertir pagos de una venta confirmada requiere politica (bloqueado)' || E'\n'; fails := fails + (not c)::int;
  begin perform public.cancel_sale(s1, 'prueba'); c := false;
  exception when feature_not_supported then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cancelar una venta confirmada requiere politica (bloqueado)' || E'\n'; fails := fails + (not c)::int;

  -- ===== Rechazo y cancelacion =====
  s2 := public.create_sale(cust, 'facebook',
    jsonb_build_array(jsonb_build_object('unit_id', unit_b), jsonb_build_object('variant_id', var_id, 'quantity', 1)), null, 'key-sale-0006');
  p_tr2 := public.record_payment(s2, 'transfer', 15299, 'REF-B-0001', 'key-pay-0006');
  begin perform public.reject_payment(p_tr2, ''); c := false; exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'rechazar un pago exige motivo' || E'\n'; fails := fails + (not c)::int;
  t := public.reject_payment(p_tr2, 'No llego el deposito');
  c := (t = 'rejected' and (select count(*) from public.payments where id = p_tr2) = 1
        and (select status from public.sales where id = s2) = 'pending');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'pago rechazado se conserva y la venta sigue pendiente' || E'\n'; fails := fails + (not c)::int;
  t := public.cancel_sale(s2, 'Cliente desistio');
  c := (t = 'cancelled' and (select status from public.product_units where id = unit_b) = 'available'
        and (select stock_quantity from public.product_variants where id = var_id) = 3);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cancelar libera el iPhone y devuelve el stock' || E'\n'; fails := fails + (not c)::int;
  c := (public.cancel_sale(s2, 'otra vez') = 'cancelled'
        and (select stock_quantity from public.product_variants where id = var_id) = 3);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cancelar dos veces no devuelve el stock dos veces' || E'\n'; fails := fails + (not c)::int;

  -- ===== Referencia duplicada y reversos =====
  s3 := public.create_sale(cust, 'whatsapp', jsonb_build_array(jsonb_build_object('variant_id', var_id, 'quantity', 1)), null, 'key-sale-0007');
  s4 := public.create_sale(cust, 'whatsapp', jsonb_build_array(jsonb_build_object('variant_id', var_id, 'quantity', 1)), null, 'key-sale-0008');
  perform public.record_payment(s3, 'transfer', 100, 'REF-B-0001', 'key-pay-0007'); -- la anterior fue rechazada: se puede reutilizar
  begin perform public.record_payment(s4, 'transfer', 100, 'ref-b-0001', 'key-pay-0008'); c := false;
  exception when unique_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la misma referencia de transferencia vigente es rechazada (pago duplicado)' || E'\n'; fails := fails + (not c)::int;

  p_rev := public.record_payment(s4, 'cash', 100, null, 'key-pay-0009');
  begin perform public.cancel_sale(s4, 'prueba'); c := false; exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se cancela una venta con pagos confirmados' || E'\n'; fails := fails + (not c)::int;
  t := public.reverse_payment(p_rev, 'Cobro registrado por error');
  select * into sm from public.sale_summaries where id = s4;
  c := (t = 'reversed' and sm.confirmed_paid = 0 and (select count(*) from public.payments where id = p_rev and status = 'reversed') = 1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un reverso conserva el historial y baja el saldo cobrado' || E'\n'; fails := fails + (not c)::int;
  perform public.cancel_sale(s4, 'Prueba');
  c := ((select status from public.sales where id = s4) = 'cancelled');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'tras el reverso la venta se puede cancelar' || E'\n'; fails := fails + (not c)::int;

  -- ===== Regresiones de la revision adversarial =====
  c := not has_function_privilege('anon', 'public.complete_sale_if_paid(uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.complete_sale_if_paid(uuid)', 'execute')
       and not has_function_privilege('anon', 'public.assert_admin()', 'execute')
       and not has_function_privilege('authenticated', 'public.assert_admin()', 'execute');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'funciones internas no son ejecutables por anon ni authenticated' || E'\n'; fails := fails + (not c)::int;
  c := not has_function_privilege('anon', 'public.create_sale(uuid,text,jsonb,text,text)', 'execute')
       and not has_function_privilege('anon', 'public.record_payment(uuid,text,numeric,text,text)', 'execute')
       and not has_function_privilege('anon', 'public.confirm_payment(uuid)', 'execute')
       and not has_function_privilege('anon', 'public.cancel_sale(uuid,text)', 'execute')
       and not has_function_privilege('anon', 'public.adjust_variant_stock(uuid,text,integer,text,text)', 'execute')
       and not has_function_privilege('anon', 'public.register_unit(uuid,text,text,integer,text,text,text,integer,numeric,numeric,text,text)', 'execute');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no tiene EXECUTE en ninguna RPC' || E'\n'; fails := fails + (not c)::int;

  begin perform public.create_sale(cust, 'other', jsonb_build_array(jsonb_build_object('unit_id', unit_b, 'unit_price', 'NaN')), null, 'key-nan-0001'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un precio NaN es rechazado' || E'\n'; fails := fails + (not c)::int;
  begin perform public.record_payment(s3, 'cash', 'NaN', null, 'key-nan-0002'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un importe de pago NaN es rechazado' || E'\n'; fails := fails + (not c)::int;
  begin update public.product_variants set price = 'NaN' where id = var_id; c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un precio NaN en el catalogo es rechazado' || E'\n'; fails := fails + (not c)::int;

  begin perform public.create_sale(cust, 'whatsapp',
      jsonb_build_array(jsonb_build_object('unit_id', unit_b), jsonb_build_object('variant_id', var_id, 'quantity', 1)), null, 'key-sale-0001'); c := false;
  exception when unique_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'reutilizar la clave de una venta con otros datos es un error' || E'\n'; fails := fails + (not c)::int;
  begin perform public.record_payment(s3, 'cash', 50, null, 'key-pay-0003'); c := false;
  exception when unique_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'reutilizar la clave de un pago con otros datos es un error' || E'\n'; fails := fails + (not c)::int;

  c := exists (select 1 from public.audit_logs where entity = 'sales' and entity_id = s1 and action = 'create_sale'
               and jsonb_array_length(details -> 'price_overrides') = 1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un precio distinto al del catalogo queda en auditoria' || E'\n'; fails := fails + (not c)::int;

  update public.products set is_active = false where id = prod_ac;
  begin perform public.create_sale(cust, 'other', jsonb_build_array(jsonb_build_object('variant_id', var_id, 'quantity', 1)), null, 'key-inact-0001'); c := false;
  exception when check_violation then c := true; end;
  update public.products set is_active = true where id = prod_ac;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se vende un producto inactivo' || E'\n'; fails := fails + (not c)::int;
  -- ===== Escrituras directas bloqueadas =====
  begin insert into public.sales (customer_id, source, idempotency_key) values (cust, 'other', 'direct-insert-1'); c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'las ventas no se crean con INSERT directo' || E'\n'; fails := fails + (not c)::int;
  begin update public.payments set status = 'confirmed' where id = p_tr2; c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'los pagos no se modifican con UPDATE directo' || E'\n'; fails := fails + (not c)::int;
  begin delete from public.sale_items; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'las lineas de venta no se borran' || E'\n'; fails := fails + (not c)::int;
  reset role;

  -- ===== Empleado =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', emp_id, 'role', 'authenticated')::text, true);
  begin perform public.create_sale(cust, 'other', jsonb_build_array(jsonb_build_object('unit_id', unit_b)), null, 'key-emp-sale-1'); c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no puede crear ventas' || E'\n'; fails := fails + (not c)::int;
  begin perform public.confirm_payment(p_tr2); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no puede confirmar pagos' || E'\n'; fails := fails + (not c)::int;
  select (select count(*) from public.customers) + (select count(*) from public.sales)
       + (select count(*) from public.payments) + (select count(*) from public.sale_items)
       + (select count(*) from public.sale_summaries) into n;
  c := (n = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no ve clientes, ventas ni pagos' || E'\n'; fails := fails + (not c)::int;
  reset role;

  -- ===== Visitante =====
  set local role anon;
  begin perform 1 from public.customers; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer clientes' || E'\n'; fails := fails + (not c)::int;
  begin perform 1 from public.payments; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer pagos' || E'\n'; fails := fails + (not c)::int;
  begin perform 1 from public.sale_summaries; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer ventas' || E'\n'; fails := fails + (not c)::int;
  begin perform public.record_payment(s1, 'cash', 1, null, 'key-anon-pay-1'); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede ejecutar funciones de ventas' || E'\n'; fails := fails + (not c)::int;
  reset role;

  raise exception 'TESTS_DONE failures=% %', fails, E'\n' || report;
end;
$test$;
