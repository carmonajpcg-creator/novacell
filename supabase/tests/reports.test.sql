-- Pruebas de la Fase 7 (dashboard y reportes). Se compara el estado ANTES y DESPUÉS de crear datos conocidos
-- dentro de la misma transacción (hermético: no depende de lo que haya en la base). Un solo bloque DO que revierte todo.
-- Datos de prueba: 3 ventas confirmadas (contado 1000, contado 2000, crédito financiado 3000 con costo 1000),
-- 1 venta con transferencia pendiente, 1 cancelada, 1 con un pago revertido y 1 apartado con anticipo.
do $test$
declare
  admin_id uuid := '00000000-0000-0000-0000-0000000000a1';
  emp_id uuid := '00000000-0000-0000-0000-0000000000b2';
  report text := '';
  fails int := 0;
  c boolean;
  n int;
  today date := (now() at time zone 'America/Mexico_City')::date;
  tz constant text := 'America/Mexico_City';
  cat_ip uuid; cat_ac uuid; prod_ip uuid; prod_ac uuid; var_id uuid; cust uuid;
  ua uuid; ub uuid; uc uuid; ud uuid; ue uuid;
  sa uuid; sb uuid; sc uuid; sd uuid; se uuid; cr uuid; lay uuid; pa_tr uuid; pe uuid;
  m0 jsonb; mm jsonb; m1 jsonb; m2 jsonb; m3 jsonb; sm0 jsonb; sm1 jsonb;
  d numeric;
  r record;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (admin_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
    (emp_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'emp@test.local');
  insert into public.profiles (id, role) values (admin_id, 'admin'), (emp_id, 'employee');
  insert into public.categories (name, slug, kind) values ('T iPhone', 't-iphone', 'iphone') returning id into cat_ip;
  insert into public.categories (name, slug, kind) values ('T Fundas', 't-fundas', 'accessory') returning id into cat_ac;
  insert into public.products (category_id, kind, name, slug) values (cat_ip, 'iphone', 'iPhone 15 Pro', 't-ip') returning id into prod_ip;
  insert into public.products (category_id, kind, name, slug) values (cat_ac, 'accessory', 'Funda', 't-fun') returning id into prod_ac;
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price) values (prod_ip, '490154203237518', 256, 'Negro', 'used', 400, 1000) returning id into ua;
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price) values (prod_ip, '352099001761481', 128, 'Azul', 'new', 1500, 2000) returning id into ub;
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price) values (prod_ip, '356938035643809', 128, 'Rojo', 'new', 300, 700) returning id into uc;
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price) values (prod_ip, '490154203237526', 64, 'Verde', 'new', 1000, 3500) returning id into ud;
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price) values (prod_ip, '352099001761499', 64, 'Gris', 'used', 800, 1500) returning id into ue;
  insert into public.product_variants (product_id, sku, color, price, cost, stock_quantity) values (prod_ac, 'T-FUN-1', 'Negro', 500, 200, 10) returning id into var_id;
  insert into public.customers (name, phone) values ('Cliente Reportes', '5512345678') returning id into cust;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);

  m0 := public.dashboard_metrics();
  sm0 := public.report_summary(today - 1, today);

  -- ===== Datos conocidos =====
  sa := public.create_sale(cust, 'whatsapp', jsonb_build_array(jsonb_build_object('unit_id', ua)), null, 'key-rpt-sa');
  perform public.record_payment(sa, 'cash', 600, null, 'key-rpt-a-cash');
  pa_tr := public.record_payment(sa, 'transfer', 400, 'CLAVE-RPT-1', 'key-rpt-a-tr');

  -- A mitad: la venta A aun no esta confirmada y su transferencia esta pendiente
  mm := public.dashboard_metrics();
  d := (mm -> 'sales_today' ->> 'total')::numeric - (m0 -> 'sales_today' ->> 'total')::numeric;
  c := (d = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una venta sin cobrar por completo NO cuenta como venta registrada' || E'\n'; fails := fails + (not c)::int;
  d := (mm -> 'collected_today' ->> 'total')::numeric - (m0 -> 'collected_today' ->> 'total')::numeric;
  c := (d = 600);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'solo el efectivo confirmado cuenta como cobrado (600), no la transferencia pendiente' || E'\n'; fails := fails + (not c)::int;
  c := ((mm -> 'pending_verification' ->> 'total')::numeric - (m0 -> 'pending_verification' ->> 'total')::numeric = 400
        and (mm -> 'pending_verification' ->> 'count')::int - (m0 -> 'pending_verification' ->> 'count')::int = 1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la transferencia pendiente aparece aparte, por verificar (400)' || E'\n'; fails := fails + (not c)::int;

  perform public.confirm_payment(pa_tr);
  sb := public.create_sale(cust, 'in_person', jsonb_build_array(jsonb_build_object('unit_id', ub)), null, 'key-rpt-sb');
  perform public.record_payment(sb, 'cash', 2000, null, 'key-rpt-b-cash');
  sc := public.create_sale(cust, 'whatsapp', jsonb_build_array(jsonb_build_object('unit_id', uc)), null, 'key-rpt-sc');
  perform public.record_payment(sc, 'transfer', 300, 'CLAVE-RPT-2', 'key-rpt-c-tr');
  sd := public.create_sale(cust, 'whatsapp', jsonb_build_array(jsonb_build_object('variant_id', var_id, 'quantity', 1)), null, 'key-rpt-sd');
  perform public.cancel_sale(sd, 'prueba');
  se := public.create_sale(cust, 'whatsapp', jsonb_build_array(jsonb_build_object('variant_id', var_id, 'quantity', 1)), null, 'key-rpt-se');
  pe := public.record_payment(se, 'cash', 100, null, 'key-rpt-e-cash');
  perform public.reverse_payment(pe, 'Cobro registrado por error');
  cr := public.create_credit_sale(cust, 'whatsapp', jsonb_build_array(jsonb_build_object('unit_id', ud)), 3000, 0, 'weekly', 3, today, null, 'key-rpt-credit');
  perform public.record_credit_payment(cr, 'installment', 'cash', 500, null, 'key-rpt-credit-abono');
  lay := public.create_layaway(cust, 'whatsapp', jsonb_build_array(jsonb_build_object('unit_id', ue)), 300, today + 10, null, 'key-rpt-lay');
  perform public.record_layaway_payment(lay, 'cash', 300, null, 'key-rpt-lay-pay');

  m1 := public.dashboard_metrics();

  -- ===== Venta registrada =====
  d := (m1 -> 'sales_today' ->> 'total')::numeric - (m0 -> 'sales_today' ->> 'total')::numeric;
  c := (d = 6000 and (m1 -> 'sales_today' ->> 'count')::int - (m0 -> 'sales_today' ->> 'count')::int = 3);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'ventas del dia: solo las confirmadas (3 ventas, 6000): sin pendientes, canceladas ni apartados sin entregar' || E'\n'; fails := fails + (not c)::int;
  d := (m1 -> 'sales_month' ->> 'total')::numeric - (m0 -> 'sales_month' ->> 'total')::numeric;
  c := (d = 6000 and (m1 -> 'sales_month' ->> 'count')::int - (m0 -> 'sales_month' ->> 'count')::int = 3);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'ventas del mes coinciden (6000)' || E'\n'; fails := fails + (not c)::int;
  c := ((m1 -> 'sales_today' ->> 'total')::numeric - (m0 -> 'sales_today' ->> 'total')::numeric
        <> (m1 -> 'collected_today' ->> 'total')::numeric - (m0 -> 'collected_today' ->> 'total')::numeric);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'venta registrada y dinero cobrado son cifras distintas (el credito se registra completo, se cobra por abonos)' || E'\n'; fails := fails + (not c)::int;

  -- ===== Dinero cobrado =====
  d := (m1 -> 'collected_today' ->> 'total')::numeric - (m0 -> 'collected_today' ->> 'total')::numeric;
  c := (d = 3800);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cobrado hoy = 3800 (1000 + 2000 + abono 500 + anticipo 300), sin pendientes ni revertidos' || E'\n'; fails := fails + (not c)::int;
  c := ((m1 -> 'collected_today' ->> 'cash')::numeric - (m0 -> 'collected_today' ->> 'cash')::numeric = 3400
        and (m1 -> 'collected_today' ->> 'transfer')::numeric - (m0 -> 'collected_today' ->> 'transfer')::numeric = 400);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cobrado por metodo: efectivo 3400 y transferencia 400' || E'\n'; fails := fails + (not c)::int;
  d := (m1 -> 'collected_month' ->> 'total')::numeric - (m0 -> 'collected_month' ->> 'total')::numeric;
  c := (d = 3800);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cobrado del mes coincide (3800)' || E'\n'; fails := fails + (not c)::int;
  c := ((m1 -> 'pending_verification' ->> 'total')::numeric - (m0 -> 'pending_verification' ->> 'total')::numeric = 300
        and (m1 -> 'pending_verification' ->> 'count')::int - (m0 -> 'pending_verification' ->> 'count')::int = 1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'por verificar: solo la transferencia pendiente de la venta C (300)' || E'\n'; fails := fails + (not c)::int;

  -- ===== Reversos (R9) =====
  c := ((m1 -> 'reversed_today' ->> 'count')::int - (m0 -> 'reversed_today' ->> 'count')::int = 1
        and (m1 -> 'reversed_today' ->> 'total')::numeric - (m0 -> 'reversed_today' ->> 'total')::numeric = 100
        and (m1 -> 'reversed_month' ->> 'total')::numeric - (m0 -> 'reversed_month' ->> 'total')::numeric = 100);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el pago revertido (100) aparece como reverso y no como cobrado' || E'\n'; fails := fails + (not c)::int;
  c := exists (select 1 from public.report_reversals(today, today) rv where rv.payment_id = pe and rv.amount = 100 and rv.reason = 'Cobro registrado por error');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'report_reversals lista el reverso con su motivo' || E'\n'; fails := fails + (not c)::int;
  c := ((public.report_summary(today, today) ->> 'reversed_total')::numeric - (sm0 ->> 'reversed_total')::numeric = 100);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'report_summary incluye el total revertido del periodo' || E'\n'; fails := fails + (not c)::int;

  -- ===== Utilidad estimada =====
  d := (m1 ->> 'estimated_profit_month')::numeric - (m0 ->> 'estimated_profit_month')::numeric;
  c := (d = 3100);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'utilidad estimada = total de la venta menos costo historico: 600 + 500 + 2000 = 3100 (credito completo aunque solo se cobro 500)' || E'\n'; fails := fails + (not c)::int;

  -- ===== Creditos, apartados y cuentas por cobrar =====
  c := ((m1 ->> 'credits_active')::int - (m0 ->> 'credits_active')::int = 1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'creditos activos +1' || E'\n'; fails := fails + (not c)::int;
  d := (m1 ->> 'receivable_credits')::numeric - (m0 ->> 'receivable_credits')::numeric;
  c := (d = 2500);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cuentas por cobrar de creditos = 3000 - 500 abonado = 2500' || E'\n'; fails := fails + (not c)::int;
  d := (m1 ->> 'receivable_layaways')::numeric - (m0 ->> 'receivable_layaways')::numeric;
  c := (d = 1200);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cuentas por cobrar de apartados = 1500 - 300 = 1200' || E'\n'; fails := fails + (not c)::int;
  c := ((m1 -> 'overdue_installments' ->> 'count')::int - (m0 -> 'overdue_installments' ->> 'count')::int = 0
        and (m1 -> 'overdue_layaways' ->> 'count')::int - (m0 -> 'overdue_layaways' ->> 'count')::int = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'sin atrasos todavia: saldos vencidos sin cambio' || E'\n'; fails := fails + (not c)::int;

  -- ===== Inventario =====
  c := ((m1 ->> 'available_units')::int - (m0 ->> 'available_units')::int = -5);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'productos disponibles: 5 unidades dejaron de estar disponibles (vendidas o reservadas)' || E'\n'; fails := fails + (not c)::int;
  c := ((m1 ->> 'accessory_pieces')::int - (m0 ->> 'accessory_pieces')::int = -1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'accesorios: la venta cancelada devolvio su pieza y solo queda descontada la pendiente (-1)' || E'\n'; fails := fails + (not c)::int;

  -- ===== Vencidos (se simulan fechas pasadas como propietario) =====
  reset role;
  update public.installments set due_date = today - 2 where credit_id = cr and number = 1;
  update public.layaways set due_date = today - 4 where id = lay;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  m2 := public.dashboard_metrics();
  c := ((m2 -> 'overdue_installments' ->> 'count')::int - (m0 -> 'overdue_installments' ->> 'count')::int = 1
        and (m2 -> 'overdue_installments' ->> 'total')::numeric - (m0 -> 'overdue_installments' ->> 'total')::numeric = 500);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'saldo vencido de creditos: la cuota 1 pagada a medias deja 500 vencidos' || E'\n'; fails := fails + (not c)::int;
  c := ((m2 -> 'overdue_layaways' ->> 'count')::int - (m0 -> 'overdue_layaways' ->> 'count')::int = 1
        and (m2 -> 'overdue_layaways' ->> 'total')::numeric - (m0 -> 'overdue_layaways' ->> 'total')::numeric = 1200);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'saldo vencido de apartados: reserva vencida con 1200 por cobrar' || E'\n'; fails := fails + (not c)::int;

  -- ===== Serie de 14 dias =====
  c := (jsonb_array_length(m2 -> 'last_14_days') = 14
        and (m2 -> 'last_14_days' -> 13 ->> 'date')::date = today
        and (m2 -> 'last_14_days' -> 0 ->> 'date')::date = today - 13);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la serie cubre exactamente los ultimos 14 dias terminando hoy' || E'\n'; fails := fails + (not c)::int;
  c := ((m2 -> 'last_14_days' -> 13 ->> 'sales_total')::numeric - (m0 -> 'last_14_days' -> 13 ->> 'sales_total')::numeric = 6000
        and (m2 -> 'last_14_days' -> 13 ->> 'collected_total')::numeric - (m0 -> 'last_14_days' -> 13 ->> 'collected_total')::numeric = 3800);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la serie separa, dia por dia, venta registrada (6000) y cobrado (3800)' || E'\n'; fails := fails + (not c)::int;

  -- ===== Zona horaria: un cobro confirmado ayer a las 23:30 (Ciudad de Mexico) no es de hoy =====
  reset role;
  update public.payments set confirmed_at = (today::timestamp at time zone tz) - interval '30 minutes' where idempotency_key = 'key-rpt-a-cash';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  m3 := public.dashboard_metrics();
  d := (m3 -> 'collected_today' ->> 'total')::numeric - (m0 -> 'collected_today' ->> 'total')::numeric;
  c := (d = 3200);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un cobro de las 23:30 de ayer (hora de CDMX) ya no cuenta como cobrado hoy' || E'\n'; fails := fails + (not c)::int;
  d := (m3 -> 'collected_month' ->> 'total')::numeric - (m0 -> 'collected_month' ->> 'total')::numeric;
  c := (d = case when extract(day from today) > 1 then 3800 else 3200 end);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'ese cobro sigue en el mes si ayer era del mismo mes' || E'\n'; fails := fails + (not c)::int;
  c := ((m3 -> 'last_14_days' -> 12 ->> 'collected_total')::numeric - (m0 -> 'last_14_days' -> 12 ->> 'collected_total')::numeric = 600);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la serie lo ubica en el dia de ayer' || E'\n'; fails := fails + (not c)::int;

  -- ===== Reporte de ventas =====
  select count(*), coalesce(sum(total), 0), coalesce(sum(cost), 0), coalesce(sum(estimated_profit), 0) into r
  from public.report_sales(today, today) where customer_name = 'Cliente Reportes';
  c := (r.count = 3 and r.coalesce = 6000);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'reporte de ventas: 3 ventas confirmadas por 6000 (sin pendientes, canceladas ni apartados)' || E'\n'; fails := fails + (not c)::int;
  select * into r from public.report_sales(today, today) where customer_name = 'Cliente Reportes' and modality = 'credit';
  c := (r.total = 3000 and r.cost = 1000 and r.estimated_profit = 2000 and r.confirmed_paid = 500 and r.balance = 2500);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'reporte del credito: total 3000, costo 1000, utilidad 2000, cobrado 500, saldo 2500 (cada cifra por separado)' || E'\n'; fails := fails + (not c)::int;
  select * into r from public.report_sales(today, today) where customer_name = 'Cliente Reportes' and total = 1000;
  c := (r.cost = 400 and r.estimated_profit = 600 and r.confirmed_paid = 1000 and r.balance = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'reporte de la venta A: lo cobrado es el total confirmado a la fecha (1000, aunque parte se cobro ayer) y el saldo es 0' || E'\n'; fails := fails + (not c)::int;
  select count(*) into n from public.report_sales(today, today) where customer_name = 'Cliente Reportes' and total in (700, 500);
  c := (n = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el reporte no incluye ventas pendientes ni canceladas' || E'\n'; fails := fails + (not c)::int;

  -- ===== Reporte de cobros =====
  select count(*), coalesce(sum(amount), 0) into r from public.report_payments(today - 1, today) p where customer_name = 'Cliente Reportes';
  c := (r.count = 5 and r.coalesce = 3800);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'reporte de cobros: 5 pagos confirmados por 3800 (sin el pendiente ni el revertido)' || E'\n'; fails := fails + (not c)::int;
  select count(*), coalesce(sum(amount), 0) into r from public.report_payments(today, today) p where customer_name = 'Cliente Reportes';
  c := (r.count = 4 and r.coalesce = 3200);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el rango de un dia respeta la fecha de confirmacion (hora de CDMX)' || E'\n'; fails := fails + (not c)::int;
  c := exists (select 1 from public.report_payments(today, today) p where customer_name = 'Cliente Reportes' and kind = 'installment' and amount = 500)
       and exists (select 1 from public.report_payments(today, today) p where customer_name = 'Cliente Reportes' and kind = 'layaway' and amount = 300);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el reporte distingue abonos de credito y pagos de apartado' || E'\n'; fails := fails + (not c)::int;

  -- ===== Resumen del reporte (calculado en la base de datos) =====
  sm1 := public.report_summary(today - 1, today);
  c := ((sm1 ->> 'sales_total')::numeric - (sm0 ->> 'sales_total')::numeric = 6000
        and (sm1 ->> 'sales_count')::int - (sm0 ->> 'sales_count')::int = 3
        and (sm1 ->> 'cost_total')::numeric - (sm0 ->> 'cost_total')::numeric = 2900
        and (sm1 ->> 'collected_total')::numeric - (sm0 ->> 'collected_total')::numeric = 3800
        and (sm1 ->> 'collected_cash')::numeric - (sm0 ->> 'collected_cash')::numeric = 3400
        and (sm1 ->> 'collected_transfer')::numeric - (sm0 ->> 'collected_transfer')::numeric = 400
        and (sm1 ->> 'payments_count')::int - (sm0 ->> 'payments_count')::int = 5);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'resumen: ventas 6000, costo 2900, cobrado 3800 (efectivo 3400 + transferencia 400), 5 pagos' || E'\n'; fails := fails + (not c)::int;

  -- Rangos invalidos
  begin perform * from public.report_sales(today, today - 1); c := false; exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un rango invertido es rechazado' || E'\n'; fails := fails + (not c)::int;
  begin perform * from public.report_payments(today - 400, today); c := false; exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un rango de mas de 366 dias es rechazado' || E'\n'; fails := fails + (not c)::int;
  begin perform public.report_summary(null, today); c := false; exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un rango sin fecha es rechazado' || E'\n'; fails := fails + (not c)::int;
  reset role;

  -- ===== Permisos =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', emp_id, 'role', 'authenticated')::text, true);
  begin perform public.dashboard_metrics(); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no puede ver las metricas del negocio' || E'\n'; fails := fails + (not c)::int;
  begin perform * from public.report_sales(today, today); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no puede consultar el reporte de ventas' || E'\n'; fails := fails + (not c)::int;
  begin perform * from public.report_payments(today, today); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no puede consultar el reporte de cobros' || E'\n'; fails := fails + (not c)::int;
  begin perform public.report_summary(today, today); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no puede consultar el resumen de reportes' || E'\n'; fails := fails + (not c)::int;
  reset role;

  set local role anon;
  begin perform public.dashboard_metrics(); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede ejecutar las metricas' || E'\n'; fails := fails + (not c)::int;
  begin perform * from public.report_summary(today, today); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede ejecutar los reportes' || E'\n'; fails := fails + (not c)::int;
  reset role;

  raise exception 'TESTS_DONE failures=% %', fails, E'\n' || report;
end;
$test$;
