-- Pruebas RLS de la Fase 1 (pgTAP). Ejecutar con: npx supabase test db  (requiere Docker).
begin;
select plan(11);

-- Usuarios de prueba
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'emp@test.local');
insert into public.profiles (id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000b2', 'employee');
insert into public.business_settings (key, value, is_public) values
  ('whatsapp', '"5210000000000"', true),
  ('internal_note', '"privado"', false);

-- ======================= Visitante anónimo =======================
set local role anon;
select throws_ok($$select * from public.profiles$$, '42501', null, 'anon no puede leer profiles');
select throws_ok($$select * from public.audit_logs$$, '42501', null, 'anon no puede leer audit_logs');
select results_eq($$select key from public.business_settings$$, $$values ('whatsapp')$$,
  'anon solo ve configuración pública');
select throws_ok($$insert into public.business_settings (key) values ('x')$$, '42501', null,
  'anon no puede escribir configuración');

-- ======================= Empleado (sin rol admin) =======================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select results_eq($$select count(*)::int from public.profiles$$, $$values (1)$$,
  'un usuario solo ve su propio perfil');
select throws_ok($$update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b2'$$,
  '42501', null, 'nadie puede auto-asignarse admin (sin privilegio UPDATE)');
select results_eq($$select count(*)::int from public.business_settings$$, $$values (1)$$,
  'empleado solo ve configuración pública');
select throws_ok($$insert into public.audit_logs (action, entity) values ('a','b')$$, '42501', null,
  'empleado no puede escribir auditoría');

-- ======================= Administrador =======================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select results_eq($$select count(*)::int from public.business_settings$$, $$values (2)$$,
  'admin ve toda la configuración');
select lives_ok($$insert into public.audit_logs (actor_id, action, entity)
  values ('00000000-0000-0000-0000-0000000000a1', 'test', 'test')$$, 'admin puede registrar auditoría');
select throws_ok($$delete from public.audit_logs$$, '42501', null, 'la auditoría no se puede borrar');

select * from finish();
rollback;
