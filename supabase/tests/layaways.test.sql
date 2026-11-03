-- Pruebas de la Fase 5 (apartados): reserva, anticipo, abonos, liquidación, conversión, cancelación,
-- vencimiento (sin liberar solo) y permisos. Un solo bloque DO que revierte todo.
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
  cat_ip uuid; cat_ac uuid; prod_ip uuid; prod_ac uuid; var_id uuid; unit_a uuid; unit_b uuid; unit_c uuid; cust uuid;
  l1 uuid; l1b uuid; l2 uuid; l3 uuid; l4 uuid; sale1 uuid; sale2 uuid; sale3 uuid;
  p_cash uuid; p_tr uuid; p_rest uuid; p_x uuid;
  ls record;
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
    values (prod_ip, '490154203237518', 256, 'Negro', 'used', 6000, 10000) returning id into unit_a;
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price)
    values (prod_ip, '352099001761481', 128, 'Azul', 'new', 12000, 15000) returning id into unit_b;
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price)
    values (prod_ip, '356938035643809', 128, 'Rojo', 'new', 9000, 12000) returning id into unit_c;
  insert into public.product_variants (product_id, sku, color, price, cost, stock_quantity)
    values (prod_ac, 'T-FUN-1', 'Negro', 100, 30, 10) returning id into var_id;
  insert into public.customers (name, phone) values ('Cliente Prueba', '5512345678') returning id into cust;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);

  -- ===== Crear apartado =====
  l1 := public.create_layaway(cust, 'whatsapp',
    jsonb_build_array(jsonb_build_object('unit_id', unit_a), jsonb_build_object('variant_id', var_id, 'quantity', 2)),
    2000, today + 30, 'nota', 'key-lay-0001');
  select * into ls from public.layaway_summaries where id = l1;
  select sale_id into sale1 from public.layaways where id = l1;
  c := (ls.status = 'pending_down' and ls.total = 10200 and ls.down_payment = 2000 and ls.balance = 10200
        and ls.confirmed_paid = 0 and not ls.is_expired
        and (select modality from public.sales where id = sale1) = 'layaway'
        and (select status from public.sales where id = sale1) = 'pending');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'crear apartado: pendiente de anticipo, total calculado en backend (10200)' || E'\n'; fails := fails + (not c)::int;
  c := ((select status from public.product_units where id = unit_a) = 'reserved'
        and (select stock_quantity from public.product_variants where id = var_id) = 8);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el apartado reserva el iPhone y descuenta el accesorio desde el inicio' || E'\n'; fails := fails + (not c)::int;

  l1b := public.create_layaway(cust, 'whatsapp',
    jsonb_build_array(jsonb_build_object('unit_id', unit_a), jsonb_build_object('variant_id', var_id, 'quantity', 2)),
    2000, today + 30, 'nota', 'key-lay-0001');
  c := (l1b = l1 and (select count(*) from public.layaways where customer_id = cust) = 1
        and (select stock_quantity from public.product_variants where id = var_id) = 8);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'reintento con la misma clave no duplica el apartado ni el descuento' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_layaway(cust, 'whatsapp', jsonb_build_array(jsonb_build_object('unit_id', unit_a)), 3000, today + 30, null, 'key-lay-0001'); c := false;
  exception when unique_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la misma clave con otros datos es un error' || E'\n'; fails := fails + (not c)::int;

  -- Validaciones
  begin perform public.create_layaway(cust, 'other', jsonb_build_array(jsonb_build_object('unit_id', unit_b)), 0, today + 5, null, 'key-lv-1'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un anticipo en cero es rechazado' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_layaway(cust, 'other', jsonb_build_array(jsonb_build_object('unit_id', unit_b)), 99999, today + 5, null, 'key-lv-2'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el anticipo no puede exceder el total' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_layaway(cust, 'other', jsonb_build_array(jsonb_build_object('unit_id', unit_b)), 'NaN', today + 5, null, 'key-lv-3'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un anticipo NaN es rechazado' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_layaway(cust, 'other', jsonb_build_array(jsonb_build_object('unit_id', unit_b)), 1000, today - 1, null, 'key-lv-4'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la fecha limite no puede ser pasada' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_layaway(cust, 'other', jsonb_build_array(jsonb_build_object('unit_id', unit_b)), 1000, today + 400, null, 'key-lv-5'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una fecha limite absurda es rechazada' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_layaway(cust, 'other', jsonb_build_array(jsonb_build_object('unit_id', unit_a)), 1000, today + 5, null, 'key-lv-6'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se aparta una unidad ya reservada' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_layaway(cust, 'other',
      jsonb_build_array(jsonb_build_object('unit_id', unit_b), jsonb_build_object('variant_id', var_id, 'quantity', 99)), 1000, today + 5, null, 'key-lv-7'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un apartado rechazado no deja reservas parciales' || E'\n'; fails := fails + (not c)::int;
  c := ((select status from public.product_units where id = unit_b) = 'available' and (select count(*) from public.layaways where customer_id = cust) = 1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'tras los rechazos solo existe el apartado original' || E'\n'; fails := fails + (not c)::int;

  -- ===== Anticipo y abonos =====
  p_cash := public.record_layaway_payment(l1, 'cash', 1000, null, 'key-lp-0001');
  select * into ls from public.layaway_summaries where id = l1;
  c := (ls.status = 'pending_down' and ls.confirmed_paid = 1000 and ls.balance = 9200);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un anticipo parcial no activa el apartado' || E'\n'; fails := fails + (not c)::int;
  p_tr := public.record_layaway_payment(l1, 'transfer', 1000, 'CLAVE-APT-1', 'key-lp-0002');
  select * into ls from public.layaway_summaries where id = l1;
  c := (ls.status = 'pending_down' and ls.pending_verification = 1000 and ls.confirmed_paid = 1000 and ls.balance = 9200);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una transferencia pendiente NO cuenta como cobrada ni activa el apartado' || E'\n'; fails := fails + (not c)::int;
  t := public.confirm_payment(p_tr);
  select * into ls from public.layaway_summaries where id = l1;
  c := (t = 'confirmed' and ls.status = 'active' and ls.confirmed_paid = 2000 and ls.balance = 8200);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'confirmar el pago que cubre el anticipo activa el apartado' || E'\n'; fails := fails + (not c)::int;
  c := (p_cash = public.record_layaway_payment(l1, 'cash', 1000, null, 'key-lp-0001')
        and (select count(*) from public.payments where sale_id = sale1 and kind = 'layaway') = 2);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'reintento de un pago con la misma clave no lo duplica' || E'\n'; fails := fails + (not c)::int;
  begin perform public.record_layaway_payment(l1, 'cash', 1000, 'otra', 'key-lp-0001'); c := false;
  exception when unique_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'reutilizar la clave de un pago con otra referencia es un error' || E'\n'; fails := fails + (not c)::int;
  begin perform public.record_layaway_payment(l1, 'cash', 99999, null, 'key-lp-0003'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se puede pagar mas que el saldo' || E'\n'; fails := fails + (not c)::int;
  begin perform public.record_layaway_payment(l1, 'transfer', 100, 'abc', 'key-lp-0004'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una transferencia exige clave de rastreo' || E'\n'; fails := fails + (not c)::int;
  begin perform public.record_payment(sale1, 'cash', 100, null, 'key-lp-0005'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'los pagos de contado no aplican a un apartado' || E'\n'; fails := fails + (not c)::int;

  -- ===== Liquidacion y conversion =====
  begin perform public.convert_layaway(l1); c := false; exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se convierte un apartado sin liquidar' || E'\n'; fails := fails + (not c)::int;
  p_rest := public.record_layaway_payment(l1, 'cash', 8200, null, 'key-lp-0006');
  select * into ls from public.layaway_summaries where id = l1;
  c := (ls.status = 'settled' and ls.balance = 0 and ls.settled_at is not null
        and (select status from public.product_units where id = unit_a) = 'reserved'
        and (select status from public.sales where id = sale1) = 'pending');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cubrir el total liquida el apartado; el iPhone sigue reservado hasta la entrega' || E'\n'; fails := fails + (not c)::int;
  begin perform public.record_layaway_payment(l1, 'cash', 1, null, 'key-lp-0007'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un apartado liquidado no recibe mas pagos' || E'\n'; fails := fails + (not c)::int;

  -- Reverso ANTES de convertir: reabre el apartado y conserva el registro
  t := public.reverse_payment(p_rest, 'Pago registrado por error');
  select * into ls from public.layaway_summaries where id = l1;
  c := (t = 'reversed' and ls.status = 'active' and ls.balance = 8200 and ls.settled_at is null
        and (select count(*) from public.payments where id = p_rest and status = 'reversed') = 1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un reverso conserva el pago, reabre el apartado y restituye el saldo' || E'\n'; fails := fails + (not c)::int;
  perform public.record_layaway_payment(l1, 'cash', 8200, null, 'key-lp-0008');
  c := ((select status from public.layaways where id = l1) = 'settled');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'tras el reverso se puede volver a liquidar' || E'\n'; fails := fails + (not c)::int;

  t := public.convert_layaway(l1);
  select * into ls from public.layaway_summaries where id = l1;
  c := (t = 'converted' and ls.status = 'converted' and ls.converted_at is not null
        and (select status from public.sales where id = sale1) = 'confirmed'
        and (select status from public.product_units where id = unit_a) = 'sold'
        and (select count(*) from public.inventory_movements where product_unit_id = unit_a and movement_type = 'exit') = 1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'convertir un apartado liquidado confirma la venta, vende el iPhone y registra la salida' || E'\n'; fails := fails + (not c)::int;
  c := (public.convert_layaway(l1) = 'converted'
        and (select count(*) from public.inventory_movements where product_unit_id = unit_a and movement_type = 'exit') = 1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'convertir dos veces es idempotente (una sola salida)' || E'\n'; fails := fails + (not c)::int;
  begin perform public.reverse_payment(p_cash, 'prueba'); c := false; exception when feature_not_supported then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'revertir pagos de un apartado convertido requiere politica (bloqueado)' || E'\n'; fails := fails + (not c)::int;
  begin perform public.cancel_sale(sale1, 'prueba'); c := false; exception when feature_not_supported then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cancelar un apartado convertido requiere politica (bloqueado)' || E'\n'; fails := fails + (not c)::int;
  select * into ls from public.sale_summaries where id = sale1;
  c := (ls.status = 'confirmed' and ls.confirmed_paid = 10200 and ls.total = 10200);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la venta resultante muestra el total cobrado (para el comprobante)' || E'\n'; fails := fails + (not c)::int;

  -- ===== Cancelacion =====
  l3 := public.create_layaway(cust, 'facebook', jsonb_build_array(jsonb_build_object('unit_id', unit_b)), 3000, today + 10, null, 'key-lay-0003');
  select sale_id into sale3 from public.layaways where id = l3;
  perform public.record_layaway_payment(l3, 'transfer', 3000, 'CLAVE-APT-3', 'key-lp-0009');
  begin perform public.cancel_sale(sale3, 'Cliente desistio'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cancelar un apartado con una transferencia pendiente exige confirmarla o rechazarla (puede ser dinero recibido)' || E'\n'; fails := fails + (not c)::int;
  c := ((select status from public.product_units where id = unit_b) = 'reserved');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el intento bloqueado no libera el equipo' || E'\n'; fails := fails + (not c)::int;
  perform public.reject_payment((select id from public.payments where idempotency_key = 'key-lp-0009'), 'No llego el deposito');
  t := public.cancel_sale(sale3, 'Cliente desistio');
  select * into ls from public.layaway_summaries where id = l3;
  c := (t = 'cancelled' and ls.status = 'cancelled' and ls.balance = 0
        and (select status from public.product_units where id = unit_b) = 'available'
        and (select status from public.payments where idempotency_key = 'key-lp-0009') = 'rejected');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cancelar un apartado sin pagos confirmados libera el iPhone y rechaza lo pendiente' || E'\n'; fails := fails + (not c)::int;

  l4 := public.create_layaway(cust, 'in_person', jsonb_build_array(jsonb_build_object('unit_id', unit_c)), 2000, today + 10, null, 'key-lay-0004');
  perform public.record_layaway_payment(l4, 'cash', 2000, null, 'key-lp-0010');
  begin perform public.cancel_sale((select sale_id from public.layaways where id = l4), 'Cliente desistio'); c := false;
  exception when feature_not_supported then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cancelar un apartado con anticipo cobrado requiere politica de devolucion/retencion (bloqueado)' || E'\n'; fails := fails + (not c)::int;
  c := ((select status from public.product_units where id = unit_c) = 'reserved' and (select status from public.layaways where id = l4) = 'active');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el bloqueo no libera la reserva ni cambia el estado' || E'\n'; fails := fails + (not c)::int;

  -- Hueco "revertir y luego cancelar": mientras no haya politica de devolucion/retencion, queda bloqueado
  l2 := public.create_layaway(cust, 'in_person', jsonb_build_array(jsonb_build_object('variant_id', var_id, 'quantity', 1)), 50, today + 10, null, 'key-lay-0005');
  p_x := public.record_layaway_payment(l2, 'cash', 50, null, 'key-lp-0011');
  perform public.reverse_payment(p_x, 'Cobro registrado por error');
  begin perform public.cancel_sale((select sale_id from public.layaways where id = l2), 'Cliente desistio'); c := false;
  exception when feature_not_supported then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'revertir un pago y luego cancelar tampoco evade el bloqueo de la politica de anticipos' || E'\n'; fails := fails + (not c)::int;
  c := ((select status from public.layaways where id = l2) = 'pending_down');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el apartado sigue vigente tras el intento bloqueado' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_layaway(cust, 'in_person', jsonb_build_array(jsonb_build_object('variant_id', var_id, 'quantity', 1)), 50, today + 10, 'otras notas', 'key-lay-0005'); c := false;
  exception when unique_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la huella de idempotencia incluye las notas' || E'\n'; fails := fails + (not c)::int;
  -- ===== Vencimiento: se marca, NO se libera solo =====
  reset role;
  update public.layaways set due_date = today - 3 where id = l4;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  select * into ls from public.layaway_summaries where id = l4;
  c := (ls.is_expired and ls.days_overdue = 3 and ls.status = 'active'
        and (select status from public.product_units where id = unit_c) = 'reserved');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una reserva vencida se marca (3 dias) pero NO se libera automaticamente' || E'\n'; fails := fails + (not c)::int;
  select * into ls from public.layaway_summaries where id = l1;
  c := (not ls.is_expired);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un apartado convertido no figura como vencido' || E'\n'; fails := fails + (not c)::int;

  -- ===== Anticipo minimo configurable =====
  reset role;
  begin insert into public.business_settings (key, value) values ('layaway_min_down_percent', '"abc"'::jsonb); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un anticipo minimo no numerico es rechazado al configurarlo' || E'\n'; fails := fails + (not c)::int;
  begin insert into public.business_settings (key, value) values ('layaway_min_down_percent', '150'::jsonb); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un anticipo minimo fuera de 0 a 100 es rechazado al configurarlo' || E'\n'; fails := fails + (not c)::int;
  begin insert into public.business_settings (key, value) values ('credit_allowed_frequencies', '["daily"]'::jsonb); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una frecuencia de credito invalida es rechazada al configurarla' || E'\n'; fails := fails + (not c)::int;
  insert into public.business_settings (key, value) values ('layaway_min_down_percent', '20'::jsonb);
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price)
    values (prod_ip, '490154203237526', 64, 'Verde', 'new', 5000, 8000);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  begin perform public.create_layaway(cust, 'other', jsonb_build_array(jsonb_build_object('variant_id', var_id, 'quantity', 5)), 50, today + 5, null, 'key-lm-1'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el anticipo minimo configurado (20 por ciento) se respeta' || E'\n'; fails := fails + (not c)::int;
  l4 := public.create_layaway(cust, 'other', jsonb_build_array(jsonb_build_object('variant_id', var_id, 'quantity', 5)), 100, today + 5, null, 'key-lm-2');
  c := (l4 is not null);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un anticipo igual al minimo configurado es aceptado' || E'\n'; fails := fails + (not c)::int;
  reset role;
  delete from public.business_settings where key = 'layaway_min_down_percent';

  -- trigger de tipo de pago vs modalidad (como propietario, para probar la defensa en profundidad)
  begin insert into public.payments (sale_id, kind, method, amount, idempotency_key) values (sale3, 'sale', 'cash', 10, 'key-trig-0001'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un pago de tipo venta no puede colgarse de un apartado (trigger)' || E'\n'; fails := fails + (not c)::int;

  -- ===== Invariantes =====
  c := not exists (
    select 1 from public.layaway_summaries s where
      (s.status = 'pending_down' and s.confirmed_paid >= s.down_payment) or
      (s.status = 'active' and (s.confirmed_paid < s.down_payment or s.confirmed_paid >= s.total)) or
      (s.status in ('settled', 'converted') and s.confirmed_paid <> s.total));
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'invariante: el estado del apartado es coherente con lo cobrado' || E'\n'; fails := fails + (not c)::int;
  c := not exists (
    select 1 from public.layaways l join public.product_units u on u.id = (select product_unit_id from public.sale_items where sale_id = l.sale_id and product_unit_id is not null limit 1)
    where (l.status in ('pending_down', 'active', 'settled') and u.status <> 'reserved')
       or (l.status = 'converted' and u.status <> 'sold')
       or (l.status = 'cancelled' and u.status <> 'available'));
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'invariante: el estado de la unidad es coherente con el del apartado' || E'\n'; fails := fails + (not c)::int;

  -- ===== Permisos =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  begin insert into public.layaways (sale_id, customer_id, down_payment, due_date) values (sale1, cust, 1, today); c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'los apartados no se crean con INSERT directo' || E'\n'; fails := fails + (not c)::int;
  begin update public.layaways set status = 'converted' where id = l4; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el estado del apartado no se modifica directamente' || E'\n'; fails := fails + (not c)::int;
  begin delete from public.layaways; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'los apartados no se borran' || E'\n'; fails := fails + (not c)::int;
  c := not has_function_privilege('authenticated', 'public.refresh_layaway_status(uuid)', 'execute')
       and not has_function_privilege('anon', 'public.create_layaway(uuid,text,jsonb,numeric,date,text,text)', 'execute')
       and not has_function_privilege('anon', 'public.record_layaway_payment(uuid,text,numeric,text,text)', 'execute')
       and not has_function_privilege('anon', 'public.convert_layaway(uuid)', 'execute');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'las funciones internas y las RPC no son ejecutables por anon / la interna no por authenticated' || E'\n'; fails := fails + (not c)::int;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', emp_id, 'role', 'authenticated')::text, true);
  begin perform public.create_layaway(cust, 'other', jsonb_build_array(jsonb_build_object('unit_id', unit_b)), 1000, today + 5, null, 'key-emp-1'); c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no puede crear apartados' || E'\n'; fails := fails + (not c)::int;
  begin perform public.record_layaway_payment(l4, 'cash', 1, null, 'key-emp-2'); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no puede registrar pagos de apartado' || E'\n'; fails := fails + (not c)::int;
  begin perform public.convert_layaway(l4); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no puede convertir apartados' || E'\n'; fails := fails + (not c)::int;
  select (select count(*) from public.layaways) + (select count(*) from public.layaway_summaries) into n;
  c := (n = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no ve apartados' || E'\n'; fails := fails + (not c)::int;
  reset role;

  set local role anon;
  begin perform 1 from public.layaways; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer apartados' || E'\n'; fails := fails + (not c)::int;
  begin perform 1 from public.layaway_summaries; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer el resumen de apartados' || E'\n'; fails := fails + (not c)::int;
  reset role;

  raise exception 'TESTS_DONE failures=% %', fails, E'\n' || report;
end;
$test$;
