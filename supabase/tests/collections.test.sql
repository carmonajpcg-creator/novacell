-- Pruebas de la Fase 5 (cobranza): cola de próximos/vencidos, recordatorios y seguimiento.
-- Un solo bloque DO que revierte todo. Clave: nunca existe un estado "enviado" o "entregado".
do $test$
declare
  admin_id uuid := '00000000-0000-0000-0000-0000000000a1';
  emp_id uuid := '00000000-0000-0000-0000-0000000000b2';
  report text := '';
  fails int := 0;
  c boolean;
  n int;
  today date := (now() at time zone 'America/Mexico_City')::date;
  cat_ip uuid; prod_ip uuid; unit_a uuid; unit_b uuid; unit_c uuid; cust uuid; cust2 uuid;
  cr uuid; cr_pending uuid; lay uuid; i1 uuid; i2 uuid; i3 uuid; r1 uuid; r2 uuid; rm uuid;
  q record;
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
  insert into public.customers (name, phone) values ('Cliente Cobranza', '5512345678') returning id into cust;
  insert into public.customers (name, phone) values ('Otro Cliente', '5587654321') returning id into cust2;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);

  -- Crédito activo (sin enganche) con 3 cuotas de 1000, y un apartado vigente
  cr := public.create_credit_sale(cust, 'whatsapp', jsonb_build_array(jsonb_build_object('unit_id', unit_a)), 3000, 0, 'weekly', 3, today + 7, null, 'key-col-0001');
  lay := public.create_layaway(cust, 'whatsapp', jsonb_build_array(jsonb_build_object('unit_id', unit_b)), 1000, today + 20, null, 'key-col-0002');
  perform public.record_layaway_payment(lay, 'cash', 1000, null, 'key-col-0003');
  -- Crédito aún sin activar (esperando enganche): no debe aparecer en la cola
  cr_pending := public.create_credit_sale(cust2, 'whatsapp', jsonb_build_array(jsonb_build_object('unit_id', unit_c)), 6000, 1000, 'weekly', 2, today + 7, null, 'key-col-0004');

  -- Se simulan fechas: cuota 1 vencida hace 3 días, cuota 2 vence en 2 días, cuota 3 en 9; apartado vencido hace 1 día
  reset role;
  update public.installments set due_date = today - 3 where credit_id = cr and number = 1;
  update public.installments set due_date = today + 2 where credit_id = cr and number = 2;
  update public.installments set due_date = today + 9 where credit_id = cr and number = 3;
  update public.layaways set due_date = today - 1 where id = lay;
  select id into i1 from public.installments where credit_id = cr and number = 1;
  select id into i2 from public.installments where credit_id = cr and number = 2;
  select id into i3 from public.installments where credit_id = cr and number = 3;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);

  -- ===== Cola de cobranza =====
  select * into q from public.collection_queue where ref_id = i1;
  c := (q.kind = 'installment' and q.days_overdue = 3 and q.amount_due = 1000 and q.installment_number = 1
        and q.customer_name = 'Cliente Cobranza' and q.customer_phone = '5512345678' and q.folio like 'C-%');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una cuota vencida aparece con 3 dias de atraso, importe, cliente y telefono' || E'\n'; fails := fails + (not c)::int;
  select * into q from public.collection_queue where ref_id = i2;
  c := (q.days_overdue = -2 and q.amount_due = 1000);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una cuota proxima aparece con dias negativos (faltan 2)' || E'\n'; fails := fails + (not c)::int;
  select * into q from public.collection_queue where ref_id = lay;
  c := (q.kind = 'layaway' and q.days_overdue = 1 and q.amount_due = 14000 and q.folio like 'A-%' and q.layaway_id = lay);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un apartado vencido aparece con su saldo por cobrar (14000)' || E'\n'; fails := fails + (not c)::int;
  c := not exists (select 1 from public.collection_queue where customer_id = cust2);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un credito que espera enganche no aparece en la cobranza' || E'\n'; fails := fails + (not c)::int;

  perform public.record_credit_payment(cr, 'installment', 'cash', 1000, null, 'key-col-0005');
  c := not exists (select 1 from public.collection_queue where ref_id = i1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una cuota pagada sale de la cola' || E'\n'; fails := fails + (not c)::int;
  perform public.record_credit_payment(cr, 'installment', 'transfer', 1000, 'CLAVE-COB-1', 'key-col-0006');
  c := exists (select 1 from public.collection_queue where ref_id = i2);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una transferencia pendiente NO saca la cuota de la cola' || E'\n'; fails := fails + (not c)::int;

  select * into q from public.collection_queue where ref_id = i2;
  c := (q.pending_verification = 1000);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la cola muestra lo pendiente de verificar para no reclamar un pago ya hecho' || E'\n'; fails := fails + (not c)::int;

  -- ===== Recordatorios =====
  begin insert into public.collection_reminders (customer_id, installment_id, kind, message)
      values (cust2, (select id from public.installments where credit_id = cr_pending and number = 1), 'upcoming', 'x'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se preparan recordatorios para cuotas de un credito que aun no esta activo' || E'\n'; fails := fails + (not c)::int;
  insert into public.collection_reminders (customer_id, installment_id, kind, message)
    values (cust, i2, 'upcoming', 'Hola Cliente Cobranza, te recordamos tu pago proximo.') returning id into r1;
  select * into q from public.collection_queue where ref_id = i2;
  c := (q.last_reminder_status = 'prepared' and q.last_reminder_at is not null);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un recordatorio preparado aparece en la cola con su estado' || E'\n'; fails := fails + (not c)::int;
  begin insert into public.collection_reminders (customer_id, installment_id, kind, message) values (cust2, i2, 'upcoming', 'x'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el cliente del recordatorio debe ser el de la cuota' || E'\n'; fails := fails + (not c)::int;
  begin insert into public.collection_reminders (customer_id, layaway_id, kind, message) values (cust2, lay, 'overdue', 'x'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el cliente del recordatorio debe ser el del apartado' || E'\n'; fails := fails + (not c)::int;
  begin insert into public.collection_reminders (customer_id, kind, message, status) values (cust, 'manual', 'x', 'contacted'); c := false;
  exception when insufficient_privilege or check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un recordatorio nuevo no puede nacer como contactado' || E'\n'; fails := fails + (not c)::int;
  begin insert into public.collection_reminders (customer_id, kind, message, whatsapp_opened_at) values (cust, 'manual', 'x', now()); c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'las marcas de tiempo no las puede fijar el cliente' || E'\n'; fails := fails + (not c)::int;
  begin insert into public.collection_reminders (customer_id, kind, message) values (cust, 'manual', '   '); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un mensaje vacio es rechazado' || E'\n'; fails := fails + (not c)::int;
  begin insert into public.collection_reminders (customer_id, installment_id, layaway_id, kind, message) values (cust, i2, lay, 'manual', 'x'); c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un recordatorio no puede apuntar a una cuota y a un apartado a la vez' || E'\n'; fails := fails + (not c)::int;

  -- Progresión de estados
  update public.collection_reminders set status = 'whatsapp_opened' where id = r1;
  c := ((select status from public.collection_reminders where id = r1) = 'whatsapp_opened'
        and (select whatsapp_opened_at from public.collection_reminders where id = r1) is not null
        and (select contacted_at from public.collection_reminders where id = r1) is null);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'abrir WhatsApp registra solo "WhatsApp abierto" con fecha del servidor' || E'\n'; fails := fails + (not c)::int;
  begin update public.collection_reminders set status = 'delivered' where id = r1; c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no existe un estado "entregado": abrir WhatsApp no prueba el envio' || E'\n'; fails := fails + (not c)::int;
  begin update public.collection_reminders set status = 'sent' where id = r1; c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'tampoco existe un estado "enviado"' || E'\n'; fails := fails + (not c)::int;
  begin update public.collection_reminders set status = 'prepared' where id = r1; c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el estado solo avanza (no regresa a preparado)' || E'\n'; fails := fails + (not c)::int;
  begin update public.collection_reminders set message = 'otro texto' where id = r1; c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el mensaje no cambia despues de abrir WhatsApp' || E'\n'; fails := fails + (not c)::int;
  begin update public.collection_reminders set customer_id = cust2 where id = r1; c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'los datos de origen del recordatorio no se modifican' || E'\n'; fails := fails + (not c)::int;
  begin update public.collection_reminders set whatsapp_opened_at = now() - interval '5 days' where id = r1; c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'las marcas de tiempo no se falsean' || E'\n'; fails := fails + (not c)::int;

  begin update public.collection_reminders set status = 'contacted' where id = r1; c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'registrar un contacto exige el resultado' || E'\n'; fails := fails + (not c)::int;
  begin update public.collection_reminders set status = 'contacted', outcome = 'no_answer', promised_date = today + 3 where id = r1; c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una fecha de promesa solo aplica al resultado "promesa de pago"' || E'\n'; fails := fails + (not c)::int;
  update public.collection_reminders set status = 'contacted', outcome = 'promise_to_pay', promised_date = today + 3, note = 'Pago el viernes' where id = r1;
  select * into q from public.collection_queue where ref_id = i2;
  c := (q.last_reminder_status = 'contacted' and q.last_outcome = 'promise_to_pay' and q.last_promised_date = today + 3
        and (select contacted_at from public.collection_reminders where id = r1) is not null);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el seguimiento (promesa de pago y fecha) queda en la cola' || E'\n'; fails := fails + (not c)::int;
  begin update public.collection_reminders set outcome = 'refused' where id = r1; c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el resultado de un contacto registrado no se reescribe sin rastro' || E'\n'; fails := fails + (not c)::int;
  begin update public.collection_reminders set note = 'otra nota' where id = r1; c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la nota de un contacto registrado no se modifica' || E'\n'; fails := fails + (not c)::int;  begin update public.collection_reminders set status = 'whatsapp_opened', outcome = null, promised_date = null where id = r1; c := false;
  exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un contacto registrado no retrocede' || E'\n'; fails := fails + (not c)::int;

  -- Recordatorio de un apartado y manual
  insert into public.collection_reminders (customer_id, layaway_id, kind, message) values (cust, lay, 'overdue', 'Tu apartado vencio.') returning id into r2;
  select * into q from public.collection_queue where ref_id = lay;
  c := (q.last_reminder_status = 'prepared');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un apartado tambien registra su recordatorio' || E'\n'; fails := fails + (not c)::int;
  insert into public.collection_reminders (customer_id, kind, message) values (cust2, 'manual', 'Mensaje libre.') returning id into rm;
  c := (rm is not null);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'se puede preparar un recordatorio manual para cualquier cliente' || E'\n'; fails := fails + (not c)::int;

  begin delete from public.collection_reminders; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el historial de seguimiento no se borra' || E'\n'; fails := fails + (not c)::int;
  reset role;

  -- ===== Empleado =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', emp_id, 'role', 'authenticated')::text, true);
  select (select count(*) from public.collection_queue) + (select count(*) from public.collection_reminders) into n;
  c := (n = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no ve la cobranza ni los recordatorios' || E'\n'; fails := fails + (not c)::int;
  begin insert into public.collection_reminders (customer_id, kind, message) values (cust, 'manual', 'x'); c := false;
  exception when others then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no puede crear recordatorios' || E'\n'; fails := fails + (not c)::int;
  reset role;

  -- ===== Visitante =====
  set local role anon;
  begin perform 1 from public.collection_queue; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer la cola de cobranza (nombres y telefonos)' || E'\n'; fails := fails + (not c)::int;
  begin perform 1 from public.collection_reminders; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer recordatorios' || E'\n'; fails := fails + (not c)::int;
  reset role;

  raise exception 'TESTS_DONE failures=% %', fails, E'\n' || report;
end;
$test$;
