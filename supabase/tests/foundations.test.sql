-- Pruebas RLS de la Fase 1. Un solo bloque DO que revierte todo al terminar
-- (ver tests/integration/run-db-tests.mjs). Termina siempre con la excepción TESTS_DONE.
do $test$
declare
  admin_id uuid := '00000000-0000-0000-0000-0000000000a1';
  emp_id uuid := '00000000-0000-0000-0000-0000000000b2';
  report text := '';
  fails int := 0;
  c boolean;
  n int;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (admin_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
    (emp_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'emp@test.local');
  insert into public.profiles (id, role) values (admin_id, 'admin'), (emp_id, 'employee');
  insert into public.business_settings (key, value, is_public) values
    ('business_name', '"x"', true), ('t_internal', '"y"', false);

  -- ===== Visitante anónimo =====
  set local role anon;
  begin perform 1 from public.profiles; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer profiles' || E'\n'; fails := fails + (not c)::int;
  begin perform 1 from public.audit_logs; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer audit_logs' || E'\n'; fails := fails + (not c)::int;
  select count(*) into n from public.business_settings;
  c := (n = (select count(*) from public.business_settings where is_public));
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon solo ve configuracion publica' || E'\n'; fails := fails + (not c)::int;
  begin insert into public.business_settings (key) values ('x'); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede escribir configuracion' || E'\n'; fails := fails + (not c)::int;
  reset role;

  -- ===== Empleado (sin rol admin) =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', emp_id, 'role', 'authenticated')::text, true);
  select count(*) into n from public.profiles;
  c := (n = 1);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado solo ve su propio perfil' || E'\n'; fails := fails + (not c)::int;
  begin update public.profiles set role = 'admin' where id = emp_id; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'nadie puede auto-asignarse admin' || E'\n'; fails := fails + (not c)::int;
  select count(*) into n from public.audit_logs;
  c := (n = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no ve audit_logs' || E'\n'; fails := fails + (not c)::int;
  begin insert into public.audit_logs (action, entity) values ('a', 'b'); c := false; exception when others then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no puede escribir auditoria' || E'\n'; fails := fails + (not c)::int;
  select count(*) into n from public.business_settings where not is_public;
  c := (n = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'empleado no ve configuracion privada' || E'\n'; fails := fails + (not c)::int;
  reset role;

  -- ===== Administrador =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  select count(*) into n from public.business_settings where key in ('business_name', 't_internal');
  c := (n = 2);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'admin ve toda la configuracion' || E'\n'; fails := fails + (not c)::int;
  begin
    insert into public.audit_logs (actor_id, action, entity) values (admin_id, 'test', 'test');
    c := true;
  exception when others then c := false; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'admin puede registrar auditoria' || E'\n'; fails := fails + (not c)::int;
  begin delete from public.audit_logs; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la auditoria no se puede borrar' || E'\n'; fails := fails + (not c)::int;
  reset role;

  raise exception 'TESTS_DONE failures=% %', fails, E'\n' || report;
end;
$test$;
