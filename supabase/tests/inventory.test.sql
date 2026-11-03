-- Pruebas de la Fase 2: IMEI, idempotencia, stock, historial y permisos.
-- Un solo bloque DO que revierte todo (ver tests/integration/run-db-tests.mjs).
do $test$
declare
  admin_id uuid := '00000000-0000-0000-0000-0000000000a1';
  emp_id uuid := '00000000-0000-0000-0000-0000000000b2';
  report text := '';
  fails int := 0;
  c boolean;
  n int;
  s text;
  cat_ip uuid; cat_ac uuid; prod_ip uuid; prod_ac uuid; var_id uuid;
  unit1 uuid; unit1b uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (admin_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
    (emp_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'emp@test.local');
  insert into public.profiles (id, role) values (admin_id, 'admin'), (emp_id, 'employee');

  -- IMEI (algoritmo de Luhn)
  c := public.is_valid_imei('490154203237518') and not public.is_valid_imei('490154203237519')
       and not public.is_valid_imei('12345') and not public.is_valid_imei(null);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'is_valid_imei valida Luhn y formato' || E'\n'; fails := fails + (not c)::int;

  -- ===== Administrador =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);

  insert into public.categories (name, slug, kind) values ('T iPhone', 't-iphone', 'iphone') returning id into cat_ip;
  insert into public.categories (name, slug, kind) values ('T Fundas', 't-fundas', 'accessory') returning id into cat_ac;
  insert into public.products (category_id, kind, name, slug) values (cat_ip, 'iphone', 'iPhone 15 Pro', 't-iphone-15-pro') returning id into prod_ip;
  insert into public.products (category_id, kind, name, slug) values (cat_ac, 'accessory', 'Funda', 't-funda') returning id into prod_ac;

  begin insert into public.products (category_id, kind, name, slug) values (cat_ip, 'accessory', 'X', 't-x'); c := false;
  exception when foreign_key_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el tipo de producto debe coincidir con su categoria' || E'\n'; fails := fails + (not c)::int;

  -- Unidades iPhone
  unit1 := public.register_unit(prod_ip, '490154203237518', 'SN-T1', 256, 'Negro', 'used', 'A', 90, 8000, 11000, null, 'key-register-0001');
  select count(*) into n from public.inventory_movements where product_unit_id = unit1 and movement_type = 'entry';
  c := (unit1 is not null and n = 1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'registrar unidad crea movimiento de entrada' || E'\n'; fails := fails + (not c)::int;

  unit1b := public.register_unit(prod_ip, '490154203237518', 'SN-T1', 256, 'Negro', 'used', 'A', 90, 8000, 11000, null, 'key-register-0001');
  select count(*) into n from public.product_units where product_id = prod_ip;
  c := (unit1b = unit1 and n = 1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'reintento con la misma clave no duplica (idempotencia)' || E'\n'; fails := fails + (not c)::int;

  begin perform public.register_unit(prod_ip, '490154203237519', null, 128, 'Azul', 'new', null, null, 1, 2, null, 'key-register-0002'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'IMEI con digito verificador invalido es rechazado' || E'\n'; fails := fails + (not c)::int;

  begin perform public.register_unit(prod_ip, '490154203237518', null, 128, 'Azul', 'new', null, null, 1, 2, null, 'key-register-0003'); c := false;
  exception when unique_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'IMEI duplicado es rechazado' || E'\n'; fails := fails + (not c)::int;

  begin perform public.register_unit(prod_ac, '352099001761481', null, 128, 'Azul', 'new', null, null, 1, 2, null, 'key-register-0004'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se registran unidades sobre un accesorio' || E'\n'; fails := fails + (not c)::int;

  s := public.set_unit_active(unit1, false, 'Prueba', 'key-deact-0001');
  c := (s = 'inactive');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'desactivar unidad disponible' || E'\n'; fails := fails + (not c)::int;
  begin perform public.set_unit_active(unit1, false, 'Otra vez', 'key-deact-0002'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se desactiva una unidad ya inactiva' || E'\n'; fails := fails + (not c)::int;
  s := public.set_unit_active(unit1, true, 'Prueba', 'key-react-0001');
  c := (s = 'available');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'reactivar unidad inactiva' || E'\n'; fails := fails + (not c)::int;

  begin update public.product_units set status = 'sold' where id = unit1; c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el estado de la unidad no es editable directamente' || E'\n'; fails := fails + (not c)::int;

  -- Variantes de accesorios
  insert into public.product_variants (product_id, sku, color, compatible_model, price, cost)
    values (prod_ac, 'T-FUN-NEG', 'Negro', 'iPhone 15 Pro', 299, 90) returning id into var_id;
  begin insert into public.product_variants (product_id, sku, price, cost, stock_quantity) values (prod_ac, 'T-FUN-X', 1, 1, 50); c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se puede fijar stock al crear la variante' || E'\n'; fails := fails + (not c)::int;
  begin insert into public.product_variants (product_id, sku, price, cost) values (prod_ip, 'T-VAR-IP', 1, 1); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'las variantes solo aplican a accesorios' || E'\n'; fails := fails + (not c)::int;

  n := public.adjust_variant_stock(var_id, 'entry', 10, 'Compra', 'key-stock-0001');
  c := (n = 10);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'entrada de stock' || E'\n'; fails := fails + (not c)::int;
  n := public.adjust_variant_stock(var_id, 'exit', -3, null, 'key-stock-0002');
  c := (n = 7);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'salida de stock' || E'\n'; fails := fails + (not c)::int;
  n := public.adjust_variant_stock(var_id, 'exit', -3, null, 'key-stock-0002');
  c := (n = 7 and (select stock_quantity from public.product_variants where id = var_id) = 7);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'reintento de salida no descuenta dos veces' || E'\n'; fails := fails + (not c)::int;
  begin perform public.adjust_variant_stock(var_id, 'exit', -8, null, 'key-stock-0003'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se permiten existencias negativas' || E'\n'; fails := fails + (not c)::int;
  c := ((select stock_quantity from public.product_variants where id = var_id) = 7);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el rechazo no altera el stock' || E'\n'; fails := fails + (not c)::int;
  begin perform public.adjust_variant_stock(var_id, 'adjustment', -1, '', 'key-stock-0004'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un ajuste exige motivo' || E'\n'; fails := fails + (not c)::int;
  begin update public.product_variants set stock_quantity = 999 where id = var_id; c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el stock no es editable directamente' || E'\n'; fails := fails + (not c)::int;

  select count(*) into n from public.inventory_movements where product_variant_id = var_id;
  c := (n = 2);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el historial registra solo movimientos aplicados' || E'\n'; fails := fails + (not c)::int;
  begin delete from public.inventory_movements where product_variant_id = var_id; c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el historial no se puede borrar' || E'\n'; fails := fails + (not c)::int;
  begin update public.inventory_movements set reason = 'x' where product_variant_id = var_id; c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el historial no se puede modificar' || E'\n'; fails := fails + (not c)::int;
  reset role;

  -- ===== Empleado =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', emp_id, 'role', 'authenticated')::text, true);
  begin perform public.register_unit(prod_ip, '352099001761481', null, 128, 'Azul', 'new', null, null, 1, 2, null, 'key-emp-0001'); c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no puede registrar unidades' || E'\n'; fails := fails + (not c)::int;
  begin perform public.adjust_variant_stock(var_id, 'entry', 5, null, 'key-emp-0002'); c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no puede mover stock' || E'\n'; fails := fails + (not c)::int;
  select (select count(*) from public.product_units) + (select count(*) from public.product_variants)
       + (select count(*) from public.inventory_movements) + (select count(*) from public.products) into n;
  c := (n = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no ve IMEI, costos ni inventario' || E'\n'; fails := fails + (not c)::int;
  reset role;

  -- ===== Visitante =====
  set local role anon;
  begin perform 1 from public.product_units; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer unidades (IMEI/costo)' || E'\n'; fails := fails + (not c)::int;
  begin perform 1 from public.product_variants; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer variantes (costo)' || E'\n'; fails := fails + (not c)::int;
  begin perform public.adjust_variant_stock(var_id, 'entry', 5, null, 'key-anon-0001'); c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede ejecutar funciones de inventario' || E'\n'; fails := fails + (not c)::int;
  reset role;

  raise exception 'TESTS_DONE failures=% %', fails, E'\n' || report;
end;
$test$;
