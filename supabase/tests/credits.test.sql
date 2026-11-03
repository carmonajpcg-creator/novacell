-- Pruebas de la Fase 4: créditos, calendario, abonos, saldos, vencimientos, liquidación y reversos.
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
  d date[];
  amts numeric[];
  today date := (now() at time zone 'America/Mexico_City')::date;
  cat_ip uuid; cat_ac uuid; prod_ip uuid; prod_ac uuid; var_id uuid; unit_a uuid; unit_b uuid; cust uuid;
  ca uuid; ca2 uuid; cb uuid; cm uuid; cc uuid; cd uuid; sale_a uuid;
  p_down1 uuid; p_down2 uuid; p_tr uuid; p_cash uuid; p_big uuid; p_rev uuid; p_rej uuid;
  cs record; st record;
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
  insert into public.product_variants (product_id, sku, color, price, cost, stock_quantity)
    values (prod_ac, 'T-FUN-1', 'Negro', 299, 90, 10) returning id into var_id;
  insert into public.customers (name, phone) values ('Cliente Prueba', '5512345678') returning id into cust;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);

  -- ===== Crear crédito y calendario =====
  ca := public.create_credit_sale(cust, 'whatsapp', jsonb_build_array(jsonb_build_object('unit_id', unit_a)),
    9000, 1000, 'weekly', 4, today + 7, 'nota', 'key-credit-0001');
  select * into cs from public.credit_summaries where id = ca;
  select sale_id into sale_a from public.credits where id = ca;
  c := (cs.status = 'pending_down' and cs.financed_total = 9000 and cs.down_payment = 1000 and cs.principal = 8000
        and cs.balance = 8000 and (select modality from public.sales where id = sale_a) = 'credit'
        and (select total from public.sales where id = sale_a) = 9000);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'crear credito: pendiente de enganche, precio financiado y principal correctos' || E'\n'; fails := fails + (not c)::int;
  c := ((select status from public.product_units where id = unit_a) = 'reserved');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el credito reserva el iPhone hasta cubrir el enganche' || E'\n'; fails := fails + (not c)::int;
  select array_agg(amount order by number), array_agg(due_date order by number) into amts, d from public.installments where credit_id = ca;
  c := (amts = array[2000, 2000, 2000, 2000]::numeric[] and d = array[today + 7, today + 14, today + 21, today + 28]);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'calendario semanal de 4 cuotas iguales (suma = principal)' || E'\n'; fails := fails + (not c)::int;

  -- Residuo de centavos y quincenal / mensual (sin enganche: se activa de inmediato)
  cm := public.create_credit_sale(cust, 'in_person', jsonb_build_array(jsonb_build_object('variant_id', var_id, 'quantity', 1)),
    1000, 0, 'monthly', 3, make_date(extract(year from today)::int, 12, 31), null, 'key-credit-0002');
  select array_agg(amount order by number), array_agg(due_date order by number) into amts, d from public.installments where credit_id = cm;
  c := (amts = array[333.33, 333.33, 333.34]::numeric[] and (select sum(amount) from public.installments where credit_id = cm) = 1000
        and d = array[make_date(extract(year from today)::int, 12, 31), make_date(extract(year from today)::int + 1, 1, 31), make_date(extract(year from today)::int + 1, 3, 1) - 1]);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'residuo de centavos en la ultima cuota y fechas mensuales sin desfase' || E'\n'; fails := fails + (not c)::int;
  c := ((select status from public.credits where id = cm) = 'active'
        and (select status from public.sales where id = (select sale_id from public.credits where id = cm)) = 'confirmed'
        and (select stock_quantity from public.product_variants where id = var_id) = 9);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'sin enganche el credito se activa y la venta se confirma' || E'\n'; fails := fails + (not c)::int;
  cb := public.create_credit_sale(cust, 'in_person', jsonb_build_array(jsonb_build_object('variant_id', var_id, 'quantity', 1)),
    900, 0, 'biweekly', 2, today, null, 'key-credit-0003');
  select array_agg(due_date order by number) into d from public.installments where credit_id = cb;
  c := (d = array[today, today + 14]);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'calendario quincenal' || E'\n'; fails := fails + (not c)::int;

  -- Idempotencia
  ca2 := public.create_credit_sale(cust, 'whatsapp', jsonb_build_array(jsonb_build_object('unit_id', unit_a)),
    9000, 1000, 'weekly', 4, today + 7, 'nota', 'key-credit-0001');
  select count(*) into n from public.credits where customer_id = cust;
  c := (ca2 = ca and n = 3);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'reintento con la misma clave no duplica el credito' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_credit_sale(cust, 'whatsapp', jsonb_build_array(jsonb_build_object('unit_id', unit_a)),
      9500, 1000, 'weekly', 4, today + 7, null, 'key-credit-0001'); c := false;
  exception when unique_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la misma clave con otras condiciones es un error' || E'\n'; fails := fails + (not c)::int;

  -- Validaciones
  begin perform public.create_credit_sale(cust, 'other', jsonb_build_array(jsonb_build_object('unit_id', unit_b)), 5000, 5000, 'weekly', 4, today, null, 'key-v-1'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el enganche debe ser menor al precio financiado' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_credit_sale(cust, 'other', jsonb_build_array(jsonb_build_object('unit_id', unit_b)), 5000, 0, 'weekly', 0, today, null, 'key-v-2'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cuotas fuera de rango son rechazadas' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_credit_sale(cust, 'other', jsonb_build_array(jsonb_build_object('unit_id', unit_b)), 5000, 0, 'daily', 4, today, null, 'key-v-3'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'frecuencia invalida es rechazada' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_credit_sale(cust, 'other', jsonb_build_array(jsonb_build_object('unit_id', unit_b)), 5000, 0, 'weekly', 4, today - 1, null, 'key-v-4'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la primera fecha no puede ser pasada' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_credit_sale(cust, 'other', jsonb_build_array(jsonb_build_object('unit_id', unit_b)), 'NaN', 0, 'weekly', 4, today, null, 'key-v-5'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'precio financiado NaN es rechazado' || E'\n'; fails := fails + (not c)::int;
  c := ((select status from public.product_units where id = unit_b) = 'available');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un credito rechazado no reserva inventario' || E'\n'; fails := fails + (not c)::int;

  -- ===== Enganche =====
  begin perform public.record_credit_payment(ca, 'installment', 'cash', 100, null, 'key-cp-0001'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no hay abonos antes de cubrir el enganche' || E'\n'; fails := fails + (not c)::int;
  begin perform public.record_payment(sale_a, 'cash', 100, null, 'key-cp-0002'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'los pagos de contado no aplican a ventas a credito' || E'\n'; fails := fails + (not c)::int;

  p_down1 := public.record_credit_payment(ca, 'down_payment', 'cash', 400, null, 'key-cp-0003');
  c := ((select status from public.credits where id = ca) = 'pending_down' and (select status from public.product_units where id = unit_a) = 'reserved');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un enganche parcial no activa el credito' || E'\n'; fails := fails + (not c)::int;
  begin perform public.record_credit_payment(ca, 'down_payment', 'cash', 700, null, 'key-cp-0004'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el enganche no puede exceder lo pactado' || E'\n'; fails := fails + (not c)::int;
  p_down2 := public.record_credit_payment(ca, 'down_payment', 'cash', 600, null, 'key-cp-0005');
  select * into cs from public.credit_summaries where id = ca;
  c := (cs.status = 'active' and cs.down_paid = 1000 and (select status from public.sales where id = sale_a) = 'confirmed'
        and (select status from public.product_units where id = unit_a) = 'sold'
        and (select count(*) from public.inventory_movements where product_unit_id = unit_a and movement_type = 'exit') = 1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cubrir el enganche activa el credito, vende el iPhone y registra la salida' || E'\n'; fails := fails + (not c)::int;
  begin perform public.reverse_payment(p_down2, 'prueba'); c := false;
  exception when feature_not_supported then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'revertir el enganche de un credito activo requiere politica (bloqueado)' || E'\n'; fails := fails + (not c)::int;

  -- ===== Abonos =====
  p_tr := public.record_credit_payment(ca, 'installment', 'transfer', 2000, 'CLAVE-ABONO-1', 'key-cp-0006');
  select * into cs from public.credit_summaries where id = ca;
  c := (cs.pending_verification = 2000 and cs.balance = 8000 and cs.installments_paid = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una transferencia pendiente NO baja el saldo' || E'\n'; fails := fails + (not c)::int;
  t := public.confirm_payment(p_tr);
  select * into cs from public.credit_summaries where id = ca;
  c := (t = 'confirmed' and cs.balance = 6000 and cs.installments_paid = 2000 and cs.pending_verification = 0
        and (select paid from public.installment_status where credit_id = ca and number = 1) = 2000);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'confirmar el abono actualiza el saldo y paga la cuota 1' || E'\n'; fails := fails + (not c)::int;
  c := (public.confirm_payment(p_tr) = 'confirmed' and (select count(*) from public.payment_allocations where payment_id = p_tr) = 1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'confirmar dos veces no aplica el abono dos veces' || E'\n'; fails := fails + (not c)::int;

  p_cash := public.record_credit_payment(ca, 'installment', 'cash', 500, null, 'key-cp-0007');
  c := (p_cash = public.record_credit_payment(ca, 'installment', 'cash', 500, null, 'key-cp-0007')
        and (select balance from public.credit_summaries where id = ca) = 5500);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'abono parcial en efectivo; reintento con la misma clave no duplica' || E'\n'; fails := fails + (not c)::int;
  begin perform public.record_credit_payment(ca, 'installment', 'cash', 600, null, 'key-cp-0007'); c := false;
  exception when unique_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'reutilizar la clave de un abono con otro importe es un error' || E'\n'; fails := fails + (not c)::int;

  -- Abono anticipado que cubre el resto de la cuota 2 y parte de la 3 (aplicacion FIFO)
  p_big := public.record_credit_payment(ca, 'installment', 'cash', 2000, null, 'key-cp-0008');
  select array_agg(paid order by number) into amts from public.installment_status where credit_id = ca;
  c := (amts = array[2000, 2000, 500, 0]::numeric[]);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'los abonos se aplican a la cuota mas antigua primero (FIFO, parcial y anticipado)' || E'\n'; fails := fails + (not c)::int;
  select count(*) into n from public.payment_allocations where payment_id = p_big;
  c := (n = 2 and (select sum(amount) from public.payment_allocations where payment_id = p_big) = 2000);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un abono se reparte en varias cuotas y suma exactamente su importe' || E'\n'; fails := fails + (not c)::int;

  begin perform public.record_credit_payment(ca, 'installment', 'cash', 100000, null, 'key-cp-0009'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se puede abonar mas que el saldo' || E'\n'; fails := fails + (not c)::int;
  begin perform public.record_credit_payment(ca, 'installment', 'transfer', 100, 'abc', 'key-cp-0010'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una transferencia exige clave de rastreo' || E'\n'; fails := fails + (not c)::int;

  -- Rechazo de un pago pendiente
  p_rej := public.record_credit_payment(ca, 'installment', 'transfer', 700, 'CLAVE-ABONO-2', 'key-cp-0011');
  t := public.reject_payment(p_rej, 'No llego el deposito');
  select * into cs from public.credit_summaries where id = ca;
  c := (t = 'rejected' and cs.balance = 3500 and cs.pending_verification = 0
        and (select count(*) from public.payments where id = p_rej) = 1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un abono rechazado se conserva y no cambia el saldo (3500)' || E'\n'; fails := fails + (not c)::int;

  -- ===== Vencimientos (se simulan fechas pasadas como propietario) =====
  reset role;
  update public.installments set due_date = today - 3 where credit_id = ca and number in (1, 3);
  update public.installments set due_date = today - 1 where credit_id = ca and number = 4;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  select * into st from public.installment_status where credit_id = ca and number = 1;
  c := (st.is_overdue = false and st.days_overdue = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una cuota pagada no esta vencida aunque su fecha ya paso' || E'\n'; fails := fails + (not c)::int;
  select * into st from public.installment_status where credit_id = ca and number = 3;
  c := (st.is_overdue and st.days_overdue = 3 and st.remaining = 1500);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una cuota parcialmente pagada y vencida se detecta (3 dias, 1500 pendientes)' || E'\n'; fails := fails + (not c)::int;
  select * into cs from public.credit_summaries where id = ca;
  c := (cs.overdue_count = 2 and cs.overdue_amount = 3500 and cs.next_due_date = today - 3);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el resumen suma los vencidos (2 cuotas, 3500)' || E'\n'; fails := fails + (not c)::int;

  -- ===== Liquidacion anticipada =====
  p_cash := public.record_credit_payment(ca, 'installment', 'cash', 3500, null, 'key-cp-0012');
  select * into cs from public.credit_summaries where id = ca;
  c := (cs.status = 'settled' and cs.balance = 0 and cs.settled_at is not null and cs.overdue_count = 0
        and (select count(*) from public.installment_status where credit_id = ca and remaining > 0) = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cubrir el saldo liquida el credito (estado settled, sin vencidos)' || E'\n'; fails := fails + (not c)::int;
  begin perform public.record_credit_payment(ca, 'installment', 'cash', 1, null, 'key-cp-0013'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un credito liquidado no recibe mas abonos' || E'\n'; fails := fails + (not c)::int;

  -- ===== Reverso de un abono =====
  t := public.reverse_payment(p_cash, 'Abono registrado por error');
  select * into cs from public.credit_summaries where id = ca;
  c := (t = 'reversed' and cs.status = 'active' and cs.balance = 3500 and cs.settled_at is null
        and (select count(*) from public.payments where id = p_cash and status = 'reversed') = 1
        and (select count(*) from public.payment_allocations where payment_id = p_cash and reversed_at is not null) >= 1
        and (select count(*) from public.payment_allocations where payment_id = p_cash and reversed_at is null) = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un reverso conserva el pago y sus aplicaciones, reabre el credito y restituye el saldo' || E'\n'; fails := fails + (not c)::int;
  c := (public.reverse_payment(p_cash, 'otra vez') = 'reversed');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'revertir dos veces es idempotente' || E'\n'; fails := fails + (not c)::int;
  perform public.record_credit_payment(ca, 'installment', 'cash', 3500, null, 'key-cp-0014');
  c := ((select status from public.credits where id = ca) = 'settled');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'tras el reverso se puede volver a liquidar' || E'\n'; fails := fails + (not c)::int;

  -- ===== Cancelacion =====
  cc := public.create_credit_sale(cust, 'facebook', jsonb_build_array(jsonb_build_object('unit_id', unit_b)),
    14000, 2000, 'weekly', 6, today + 7, null, 'key-credit-0004');
  perform public.record_credit_payment(cc, 'down_payment', 'transfer', 2000, 'CLAVE-ENG-1', 'key-cp-0015');
  begin perform public.cancel_sale((select sale_id from public.credits where id = cc), 'Cliente desistio'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cancelar un credito con un pago pendiente exige confirmarlo o rechazarlo antes' || E'\n'; fails := fails + (not c)::int;
  perform public.reject_payment((select id from public.payments where idempotency_key = 'key-cp-0015'), 'No llego el deposito');
  t := public.cancel_sale((select sale_id from public.credits where id = cc), 'Cliente desistio');
  c := (t = 'cancelled' and (select status from public.credits where id = cc) = 'cancelled'
        and (select status from public.product_units where id = unit_b) = 'available'
        and (select status from public.payments where idempotency_key = 'key-cp-0015') = 'rejected');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cancelar un credito sin enganche confirmado libera el iPhone y rechaza el pago pendiente' || E'\n'; fails := fails + (not c)::int;
  begin perform public.cancel_sale(sale_a, 'prueba'); c := false;
  exception when feature_not_supported then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cancelar un credito activo requiere politica (bloqueado)' || E'\n'; fails := fails + (not c)::int;

  -- ===== Regresiones de la revision adversarial (Opus) =====
  begin perform public.create_credit_sale(cust, 'other', jsonb_build_array(jsonb_build_object('unit_id', unit_b)), 1.00, 0.99, 'weekly', 2, today, null, 'key-rv-1'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un saldo demasiado pequeno para las cuotas da un error claro (cuota minima 0.01)' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_credit_sale(cust, 'other', jsonb_build_array(jsonb_build_object('unit_id', unit_b)), 5000, 0, 'weekly', 4, today + 400, null, 'key-rv-2'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una primera fecha absurda es rechazada con un error claro' || E'\n'; fails := fails + (not c)::int;
  begin perform public.create_credit_sale(cust, 'other', jsonb_build_array(jsonb_build_object('unit_id', unit_b, 'unit_price', '100.005')), 5000, 0, 'weekly', 4, today, null, 'key-rv-3'); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un precio con 3 decimales se rechaza (no se redondea en silencio)' || E'\n'; fails := fails + (not c)::int;
  c := (public.create_credit_sale(cust, 'whatsapp', jsonb_build_array(jsonb_build_object('unit_id', unit_a)), 9000.00, 1000.00, 'weekly', 4, today + 7, 'nota', 'key-credit-0001') = ca);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'reintento con 9000.00 en vez de 9000 sigue siendo el mismo credito (huella estable)' || E'\n'; fails := fails + (not c)::int;
  select * into cs from public.credit_summaries where id = cc;
  c := (cs.status = 'cancelled' and cs.balance = 0 and cs.next_due_date is null and cs.overdue_count = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un credito cancelado no muestra saldo ni proximo vencimiento' || E'\n'; fails := fails + (not c)::int;
  begin perform public.record_payment(sale_a, 'cash', 3500, null, 'key-cp-0014'); c := false;
  exception when check_violation or unique_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la clave de un abono de credito no se reutiliza en un pago de contado' || E'\n'; fails := fails + (not c)::int;
  begin perform public.record_credit_payment(ca, 'installment', 'cash', 3500, 'otra-ref', 'key-cp-0014'); c := false;
  exception when unique_violation or check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'reutilizar la clave de un abono con otra referencia es un error' || E'\n'; fails := fails + (not c)::int;
  begin update public.credits set status = 'settled' where id = cc; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el estado del credito no se modifica directamente' || E'\n'; fails := fails + (not c)::int;
  -- ===== Invariantes de integridad =====
  c := not exists (
    select 1 from public.credit_summaries s
    where s.status in ('active', 'settled') and s.balance <> s.principal - (
      select coalesce(sum(a.amount), 0) from public.payment_allocations a
      join public.installments i on i.id = a.installment_id
      where i.credit_id = s.id and a.reversed_at is null));
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'invariante: saldo = principal - aplicaciones vigentes' || E'\n'; fails := fails + (not c)::int;
  c := not exists (select 1 from public.installment_status where paid > amount or remaining < 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'invariante: ninguna cuota pagada de mas' || E'\n'; fails := fails + (not c)::int;
  c := not exists (
    select 1 from public.payments p where p.kind = 'installment' and p.status = 'confirmed'
      and p.amount <> (select coalesce(sum(a.amount), 0) from public.payment_allocations a where a.payment_id = p.id and a.reversed_at is null));
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'invariante: cada abono confirmado esta aplicado por completo' || E'\n'; fails := fails + (not c)::int;

  -- ===== Escrituras directas bloqueadas =====
  begin insert into public.credits (sale_id, customer_id, financed_total, down_payment, principal, frequency, installments_count, first_due_date)
      values (sale_a, cust, 10, 0, 10, 'weekly', 1, today); c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'los creditos no se crean con INSERT directo' || E'\n'; fails := fails + (not c)::int;
  begin update public.installments set amount = 1 where credit_id = ca; c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'las condiciones pactadas (cuotas) no se modifican' || E'\n'; fails := fails + (not c)::int;
  begin delete from public.payment_allocations; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'las aplicaciones de pago no se borran' || E'\n'; fails := fails + (not c)::int;
  begin update public.credits set principal = 1 where id = ca; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'las condiciones del credito no se modifican' || E'\n'; fails := fails + (not c)::int;
  c := not has_function_privilege('authenticated', 'public.allocate_payment(uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.activate_credit_if_ready(uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.finalize_sale(uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.reserve_sale_items(uuid,jsonb)', 'execute')
       and not has_function_privilege('anon', 'public.create_credit_sale(uuid,text,jsonb,numeric,numeric,text,integer,date,text,text)', 'execute')
       and not has_function_privilege('anon', 'public.record_credit_payment(uuid,text,text,numeric,text,text)', 'execute');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'las funciones internas de credito no son ejecutables desde el cliente' || E'\n'; fails := fails + (not c)::int;
  reset role;

  -- ===== Empleado =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', emp_id, 'role', 'authenticated')::text, true);
  begin perform public.create_credit_sale(cust, 'other', jsonb_build_array(jsonb_build_object('unit_id', unit_b)), 5000, 0, 'weekly', 4, today, null, 'key-emp-1'); c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no puede crear creditos' || E'\n'; fails := fails + (not c)::int;
  begin perform public.record_credit_payment(ca, 'installment', 'cash', 1, null, 'key-emp-2'); c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no puede registrar abonos' || E'\n'; fails := fails + (not c)::int;
  select (select count(*) from public.credits) + (select count(*) from public.installments)
       + (select count(*) from public.payment_allocations) + (select count(*) from public.credit_summaries)
       + (select count(*) from public.installment_status) into n;
  c := (n = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no ve creditos, cuotas ni aplicaciones' || E'\n'; fails := fails + (not c)::int;
  reset role;

  -- ===== Visitante =====
  set local role anon;
  begin perform 1 from public.credits; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer creditos' || E'\n'; fails := fails + (not c)::int;
  begin perform 1 from public.credit_summaries; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer el resumen de creditos' || E'\n'; fails := fails + (not c)::int;
  begin perform 1 from public.installments; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer cuotas' || E'\n'; fails := fails + (not c)::int;
  begin perform 1 from public.payment_allocations; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer aplicaciones de pago' || E'\n'; fails := fails + (not c)::int;
  reset role;

  raise exception 'TESTS_DONE failures=% %', fails, E'\n' || report;
end;
$test$;
