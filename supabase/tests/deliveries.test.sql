-- Pruebas de la Fase 7 (entregas): estados, validaciones, una entrega vigente por venta y permisos.
-- Un solo bloque DO que revierte todo (hermético: los conteos se acotan a los datos de la prueba).
do $test$
declare
  admin_id uuid := '00000000-0000-0000-0000-0000000000a1';
  emp_id uuid := '00000000-0000-0000-0000-0000000000b2';
  report text := '';
  fails int := 0;
  c boolean;
  n int;
  t text;
  today date := (now() at time zone 'America/Mexico_City')::date;
  cat_ip uuid; prod_ip uuid; unit_a uuid; unit_b uuid; unit_c uuid; unit_d uuid; cust uuid;
  s_ok uuid; s_pend uuid; s2 uuid; s3 uuid;
  d1 uuid; d1b uuid; d2 uuid; d3 uuid; d3b uuid;
  ssum record; total_before numeric; paid_before numeric;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (admin_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
    (emp_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'emp@test.local');
  insert into public.profiles (id, role) values (admin_id, 'admin'), (emp_id, 'employee');
  insert into public.categories (name, slug, kind) values ('T iPhone', 't-iphone', 'iphone') returning id into cat_ip;
  insert into public.products (category_id, kind, name, slug) values (cat_ip, 'iphone', 'iPhone 15 Pro', 't-ip') returning id into prod_ip;
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price)
    values (prod_ip, '490154203237518', 256, 'Negro', 'used', 6000, 10000) returning id into unit_a;
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price)
    values (prod_ip, '352099001761481', 128, 'Azul', 'new', 12000, 15000) returning id into unit_b;
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price)
    values (prod_ip, '356938035643809', 128, 'Rojo', 'new', 9000, 12000) returning id into unit_c;
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price)
    values (prod_ip, '490154203237526', 64, 'Verde', 'new', 5000, 8000) returning id into unit_d;
  insert into public.customers (name, phone) values ('Cliente Entregas', '5512345678') returning id into cust;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);

  -- Ventas: una confirmada (contado pagado) y una pendiente
  s_ok := public.create_sale(cust, 'whatsapp', jsonb_build_array(jsonb_build_object('unit_id', unit_a)), null, 'key-dsale-0001');
  perform public.record_payment(s_ok, 'cash', 10000, null, 'key-dpay-0001');
  s_pend := public.create_sale(cust, 'whatsapp', jsonb_build_array(jsonb_build_object('unit_id', unit_b)), null, 'key-dsale-0002');
  select total into total_before from public.sales where id = s_ok;
  select coalesce(sum(amount), 0) into paid_before from public.payments where sale_id = s_ok and status = 'confirmed';

  -- ===== Crear =====
  d1 := public.create_delivery(s_ok, 'Calle Falsa 123, Col. Centro, CDMX', 'Portón negro', 150, today + 2, 'Llamar al llegar', 'key-del-0001');
  select * into ssum from public.delivery_summaries where id = d1;
  c := (ssum.status = 'pending' and ssum.delivery_number like 'E-%' and ssum.delivery_cost = 150 and ssum.customer_name = 'Cliente Entregas'
        and ssum.customer_phone = '5512345678' and ssum.scheduled_date = today + 2 and ssum.sale_total = 10000);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'crear entrega: pendiente, con cliente, telefono, fecha y costo capturados' || E'\n'; fails := fails + (not c)::int;
  c := ((select total from public.sales where id = s_ok) = total_before
        and (select coalesce(sum(amount), 0) from public.payments where sale_id = s_ok and status = 'confirmed') = paid_before);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el costo de entrega NO se suma al total de la venta ni a los pagos' || E'\n'; fails := fails + (not c)::int;

  d1b := public.create_delivery(s_ok, 'Calle Falsa 123, Col. Centro, CDMX', 'Portón negro', 150, today + 2, 'Llamar al llegar', 'key-del-0001');
  c := (d1b = d1 and (select count(*) from public.deliveries where sale_id = s_ok) = 1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'reintento con la misma clave no duplica la entrega' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_delivery(s_ok, 'Otra direccion 456, CDMX', null, 0, null, null, 'key-del-0001'); c := false;
  exception when unique_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la misma clave con otra direccion es un error' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_delivery(s_ok, 'Otra direccion 456, CDMX', null, 0, null, null, 'key-del-0002'); c := false;
  exception when unique_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una venta solo tiene una entrega vigente' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_delivery(s_pend, 'Calle Falsa 123, CDMX', null, 0, null, null, 'key-del-0003'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se programa entrega de una venta no confirmada' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_delivery(gen_random_uuid(), 'Calle Falsa 123, CDMX', null, 0, null, null, 'key-del-0004'); c := false;
  exception when no_data_found then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una venta inexistente es rechazada' || E'\n'; fails := fails + (not c)::int;

  -- Validaciones
  begin perform public.create_delivery(s_ok, 'abc', null, 0, null, null, 'key-dv-0001'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la direccion es obligatoria (minimo 5 caracteres)' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_delivery(s_ok, 'Calle Falsa 123, CDMX', null, 'NaN', null, null, 'key-dv-0002'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un costo NaN es rechazado' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_delivery(s_ok, 'Calle Falsa 123, CDMX', null, -5, null, null, 'key-dv-0003'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un costo negativo es rechazado' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_delivery(s_ok, 'Calle Falsa 123, CDMX', null, 10.123, null, null, 'key-dv-0004'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un costo con 3 decimales es rechazado' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_delivery(s_ok, 'Calle Falsa 123, CDMX', null, 0, today - 1, null, 'key-dv-0005'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la fecha programada no puede ser pasada' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_delivery(s_ok, 'Calle Falsa 123, CDMX', null, 0, today + 500, null, 'key-dv-0006'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una fecha programada absurda es rechazada' || E'\n'; fails := fails + (not c)::int;

  -- ===== Estados =====
  t := public.set_delivery_status(d1, 'preparing', null);
  c := (t = 'preparing' and (select status from public.deliveries where id = d1) = 'preparing');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'pendiente a en preparacion' || E'\n'; fails := fails + (not c)::int;
  c := (public.set_delivery_status(d1, 'preparing', null) = 'preparing');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'repetir el mismo estado es idempotente' || E'\n'; fails := fails + (not c)::int;
  begin perform public.set_delivery_status(d1, 'pending', null); c := false; exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una entrega no retrocede de estado' || E'\n'; fails := fails + (not c)::int;
  begin perform public.set_delivery_status(d1, 'volando', null); c := false; exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un estado inexistente es rechazado' || E'\n'; fails := fails + (not c)::int;
  perform public.set_delivery_status(d1, 'on_the_way', null);

  -- Edicion de datos descriptivos mientras no sea terminal
  perform public.update_delivery(d1, 'Calle Nueva 99, Col. Roma, CDMX', null, 200, today + 2, null);
  c := ((select address from public.deliveries where id = d1) like 'Calle Nueva%' and (select delivery_cost from public.deliveries where id = d1) = 200);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'update_delivery corrige direccion y costo mientras la entrega sigue en curso' || E'\n'; fails := fails + (not c)::int;
  c := exists (select 1 from public.audit_logs where entity = 'deliveries' and entity_id = d1 and action = 'update_delivery');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la edicion de una entrega queda en la bitacora' || E'\n'; fails := fails + (not c)::int;
  begin perform public.update_delivery(d1, 'Calle Nueva 99, Col. Roma, CDMX', null, 'NaN', null, null); c := false; exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'update_delivery rechaza un costo NaN' || E'\n'; fails := fails + (not c)::int;
  begin perform public.update_delivery(d1, 'Calle Nueva 99, Col. Roma, CDMX', null, 10.123, null, null); c := false; exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'update_delivery rechaza un costo con 3 decimales (no redondea en silencio)' || E'\n'; fails := fails + (not c)::int;
  begin perform public.update_delivery(d1, 'abc', null, 0, null, null); c := false; exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'update_delivery exige direccion valida' || E'\n'; fails := fails + (not c)::int;
  begin perform public.update_delivery(d1, 'Calle Nueva 99, Col. Roma, CDMX', null, 0, today - 3, null); c := false; exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'update_delivery rechaza una fecha pasada nueva' || E'\n'; fails := fails + (not c)::int;
  begin update public.deliveries set delivery_cost = 1 where id = d1; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'ya no hay UPDATE directo sobre deliveries' || E'\n'; fails := fails + (not c)::int;
  begin perform public.set_delivery_status(d1, null, null); c := false; exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un estado nulo es rechazado' || E'\n'; fails := fails + (not c)::int;

  t := public.set_delivery_status(d1, 'delivered', null);
  select * into ssum from public.delivery_summaries where id = d1;
  c := (t = 'delivered' and ssum.delivered_at is not null and ssum.status = 'delivered');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'entregada: queda registrada la fecha de entrega (fijada por el servidor)' || E'\n'; fails := fails + (not c)::int;
  begin perform public.set_delivery_status(d1, 'cancelled', 'Se arrepintio'); c := false; exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una entrega entregada ya no cambia de estado' || E'\n'; fails := fails + (not c)::int;
  begin perform public.update_delivery(d1, 'Otra direccion 1, CDMX', null, 0, null, null); c := false; exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una entrega entregada es historial: sus datos no se editan' || E'\n'; fails := fails + (not c)::int;

  -- Entrega en mostrador: se puede saltar de pendiente a entregada
  s2 := public.create_sale(cust, 'in_person', jsonb_build_array(jsonb_build_object('unit_id', unit_c)), null, 'key-dsale-0003');
  perform public.record_payment(s2, 'cash', 12000, null, 'key-dpay-0002');
  d2 := public.create_delivery(s2, 'Entrega en mostrador, sucursal centro', null, 0, null, null, 'key-del-0005');
  c := (public.set_delivery_status(d2, 'delivered', null) = 'delivered');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'se puede pasar directo de pendiente a entregada (entrega en mostrador)' || E'\n'; fails := fails + (not c)::int;

  -- Cancelacion con motivo
  s3 := public.create_sale(cust, 'in_person', jsonb_build_array(jsonb_build_object('unit_id', unit_d)), null, 'key-dsale-0004');
  perform public.record_payment(s3, 'cash', 8000, null, 'key-dpay-0003');
  d3 := public.create_delivery(s3, 'Calle de Cancelacion 5, CDMX', null, 0, null, null, 'key-del-0006');
  begin perform public.set_delivery_status(d3, 'cancelled', '  '); c := false; exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cancelar una entrega exige motivo' || E'\n'; fails := fails + (not c)::int;
  t := public.set_delivery_status(d3, 'cancelled', 'Cliente no estaba');
  select * into ssum from public.delivery_summaries where id = d3;
  c := (t = 'cancelled' and ssum.cancelled_at is not null and ssum.cancel_reason = 'Cliente no estaba');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cancelar registra fecha y motivo' || E'\n'; fails := fails + (not c)::int;
  begin perform public.set_delivery_status(d3, 'preparing', null); c := false; exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una entrega cancelada ya no cambia de estado' || E'\n'; fails := fails + (not c)::int;
  d3b := public.create_delivery(s3, 'Calle de Reprogramacion 7, CDMX', null, 0, null, null, 'key-del-0007');
  c := (d3b <> d3 and (select count(*) from public.deliveries where sale_id = s3 and status <> 'cancelled') = 1
        and (select count(*) from public.deliveries where sale_id = s3) = 2);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'tras cancelar se puede reprogramar; el historial conserva ambas entregas' || E'\n'; fails := fails + (not c)::int;

  -- ===== Escrituras directas bloqueadas =====
  begin update public.deliveries set status = 'delivered' where id = d3b; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el estado no se modifica con UPDATE directo' || E'\n'; fails := fails + (not c)::int;
  begin update public.deliveries set delivered_at = now() where id = d3b; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'las fechas de entrega no se falsean' || E'\n'; fails := fails + (not c)::int;
  begin update public.deliveries set sale_id = s_ok where id = d3b; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la venta de una entrega no se cambia' || E'\n'; fails := fails + (not c)::int;
  begin insert into public.deliveries (sale_id, address, idempotency_key) values (s_ok, 'Direccion directa 1, CDMX', 'key-direct-001'); c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'las entregas no se crean con INSERT directo' || E'\n'; fails := fails + (not c)::int;
  begin delete from public.deliveries; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'las entregas no se borran' || E'\n'; fails := fails + (not c)::int;

  -- ===== Auditoria =====
  c := exists (select 1 from public.audit_logs where entity = 'deliveries' and entity_id = d1 and action = 'create_delivery')
       and (select count(*) from public.audit_logs where entity = 'deliveries' and entity_id = d1 and action = 'set_delivery_status') = 3;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la creacion y cada cambio de estado quedan en la bitacora' || E'\n'; fails := fails + (not c)::int;

  -- ===== Permisos =====
  c := not has_function_privilege('anon', 'public.create_delivery(uuid,text,text,numeric,date,text,text)', 'execute')
       and not has_function_privilege('anon', 'public.set_delivery_status(uuid,text,text)', 'execute')
       and not has_function_privilege('anon', 'public.update_delivery(uuid,text,text,numeric,date,text)', 'execute')
       and not has_function_privilege('anon', 'public.report_reversals(date,date)', 'execute')
       and not has_function_privilege('anon', 'public.dashboard_metrics()', 'execute')
       and not has_function_privilege('anon', 'public.report_sales(date,date)', 'execute');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede ejecutar las funciones de entregas ni de reportes' || E'\n'; fails := fails + (not c)::int;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', emp_id, 'role', 'authenticated')::text, true);
  begin perform public.create_delivery(s_ok, 'Direccion empleado 1, CDMX', null, 0, null, null, 'key-emp-0001'); c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no puede crear entregas' || E'\n'; fails := fails + (not c)::int;
  begin perform public.set_delivery_status(d3b, 'preparing', null); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no puede cambiar el estado de una entrega' || E'\n'; fails := fails + (not c)::int;
  begin perform public.update_delivery(d3b, 'Direccion empleado 2, CDMX', null, 0, null, null); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no puede editar una entrega' || E'\n'; fails := fails + (not c)::int;
  begin perform public.report_reversals(today, today); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no puede consultar reversos' || E'\n'; fails := fails + (not c)::int;
  select (select count(*) from public.deliveries) + (select count(*) from public.delivery_summaries) into n;
  c := (n = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no ve direcciones de entrega' || E'\n'; fails := fails + (not c)::int;
  reset role;

  set local role anon;
  begin perform 1 from public.deliveries; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer entregas (direcciones)' || E'\n'; fails := fails + (not c)::int;
  begin perform 1 from public.delivery_summaries; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer el resumen de entregas' || E'\n'; fails := fails + (not c)::int;
  reset role;

  raise exception 'TESTS_DONE failures=% %', fails, E'\n' || report;
end;
$test$;
