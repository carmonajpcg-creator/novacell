-- Pruebas de MFA: el interruptor no se puede manipular, no deja fuera al admin, y exige aal2 cuando está encendido.
do $test$
declare
  admin_id uuid := '00000000-0000-0000-0000-0000000000a1';
  emp_id uuid := '00000000-0000-0000-0000-0000000000b2';
  report text := '';
  fails int := 0;
  c boolean;
  n int;
  had_flag boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (admin_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-mfa@test.local'),
    (emp_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'emp-mfa@test.local');
  insert into public.profiles (id, role) values (admin_id, 'admin'), (emp_id, 'employee');
  select exists (select 1 from public.business_settings where key = 'require_mfa') into had_flag;

  -- ===== Apagado (estado inicial): todo funciona con aal1 =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  c := public.is_admin();
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'con MFA apagado, el admin con aal1 sigue siendo admin' || E'\n'; fails := fails + (not c)::int;
  c := (public.mfa_status() ->> 'required') = 'false';
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'mfa_status informa que no es obligatorio' || E'\n'; fails := fails + (not c)::int;

  -- ===== El interruptor no se toca a mano =====
  begin insert into public.business_settings (key, value, is_public) values ('require_mfa', 'true', false); c := false;
  exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se puede encender require_mfa con INSERT directo' || E'\n'; fails := fails + (not c)::int;
  begin update public.business_settings set value = 'false' where key = 'require_mfa'; c := true; exception when others then c := true; end;
  begin delete from public.business_settings where key = 'require_mfa'; c := true; exception when insufficient_privilege then c := true; end;

  -- ===== No se enciende sin segundo factor =====
  begin perform public.set_require_mfa(true); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'encender MFA desde una sesion aal1 es rechazado (no puede dejarse fuera)' || E'\n'; fails := fails + (not c)::int;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated;
  begin perform public.set_require_mfa(true); c := false; exception when check_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'encender MFA sin un factor verificado es rechazado aunque la sesion sea aal2' || E'\n'; fails := fails + (not c)::int;
  begin perform public.set_require_mfa(null); c := false; exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'valor nulo rechazado' || E'\n'; fails := fails + (not c)::int;
  reset role;

  -- ===== Con un factor verificado se puede encender (desde aal2) =====
  insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
    values (gen_random_uuid(), admin_id, 'totp', 'verified', now(), now());
  set local role authenticated;
  c := (public.set_require_mfa(true) = true);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'con factor verificado y sesion aal2 se enciende MFA' || E'\n'; fails := fails + (not c)::int;
  c := exists (select 1 from public.audit_logs where action = 'set_require_mfa' and actor_id = admin_id);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el cambio queda en la bitacora' || E'\n'; fails := fails + (not c)::int;
  c := public.is_admin() and (public.mfa_status() ->> 'required') = 'true';
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'con MFA encendido, aal2 sigue siendo admin' || E'\n'; fails := fails + (not c)::int;
  reset role;

  -- ===== Encendido: aal1 deja de ser admin =====
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  c := not public.is_admin();
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'con MFA encendido, una sesion aal1 (solo contrasena) NO es admin' || E'\n'; fails := fails + (not c)::int;
  select count(*) into n from public.customers;
  begin perform public.create_sale((select id from public.customers limit 1), 'whatsapp', '[]'::jsonb, null, 'key-mfa-1'); c := false;
  exception when others then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'con aal1 las operaciones de admin se rechazan' || E'\n'; fails := fails + (not c)::int;
  c := (public.mfa_status() ->> 'required') = 'true' and (public.mfa_status() ->> 'aal') = 'aal1';
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'mfa_status sigue disponible en aal1 para que la interfaz pida el codigo' || E'\n'; fails := fails + (not c)::int;
  begin perform public.set_require_mfa(false); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'apagar MFA tambien exige aal2' || E'\n'; fails := fails + (not c)::int;
  reset role;

  -- ===== Empleado =====
  perform set_config('request.jwt.claims', json_build_object('sub', emp_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated;
  c := not public.is_admin();
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un empleado nunca es admin (aunque tenga aal2)' || E'\n'; fails := fails + (not c)::int;
  begin perform public.set_require_mfa(false); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un empleado no cambia MFA' || E'\n'; fails := fails + (not c)::int;
  begin perform public.mfa_status(); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un empleado no consulta mfa_status' || E'\n'; fails := fails + (not c)::int;
  reset role;

  -- ===== anon =====
  c := not has_function_privilege('anon', 'public.set_require_mfa(boolean)', 'execute')
       and not has_function_privilege('anon', 'public.mfa_status()', 'execute');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no ejecuta las funciones de MFA' || E'\n'; fails := fails + (not c)::int;
  c := not had_flag;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'precondicion: la base no tenia MFA obligatorio al iniciar la prueba' || E'\n'; fails := fails + (not c)::int;

  raise exception 'TESTS_DONE failures=% %', fails, E'\n' || report;
end;
$test$;
