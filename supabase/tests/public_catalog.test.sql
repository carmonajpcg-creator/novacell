-- Pruebas de la Fase 6 (tienda pública): lo que ve un visitante sin sesión y, sobre todo, lo que NO ve.
-- Un solo bloque DO que revierte todo. Los conteos se acotan a los datos de la prueba (hermético).
do $test$
declare
  report text := '';
  fails int := 0;
  c boolean;
  n int;
  cols text;
  cat_ip uuid; cat_ac uuid; cat_off uuid;
  p_ip uuid; p_ip_draft uuid; p_ac uuid; p_inactive uuid; p_off_cat uuid;
  u_av uuid; u_res uuid; u_sold uuid; u_inact uuid; u_draft uuid; u_av2 uuid;
  v_ok uuid; v_low uuid; v_zero uuid; v_off uuid;
  code_av text;
  r record;
begin
  insert into public.categories (name, slug, kind) values ('T iPhone', 't-iphone', 'iphone') returning id into cat_ip;
  insert into public.categories (name, slug, kind) values ('T Fundas', 't-fundas', 'accessory') returning id into cat_ac;
  insert into public.categories (name, slug, kind, is_active) values ('T Oculta', 't-oculta', 'iphone', false) returning id into cat_off;

  insert into public.products (category_id, kind, name, slug, is_published) values (cat_ip, 'iphone', 'T iPhone 15 Pro', 't-ip-15', true) returning id into p_ip;
  insert into public.products (category_id, kind, name, slug, is_published) values (cat_ip, 'iphone', 'T iPhone Borrador', 't-ip-draft', false) returning id into p_ip_draft;
  insert into public.products (category_id, kind, name, slug, is_published) values (cat_ac, 'accessory', 'T Funda', 't-funda', true) returning id into p_ac;
  insert into public.products (category_id, kind, name, slug, is_published, is_active) values (cat_ac, 'accessory', 'T Inactivo', 't-inactivo', true, false) returning id into p_inactive;
  insert into public.products (category_id, kind, name, slug, is_published) values (cat_off, 'iphone', 'T En categoria oculta', 't-oculta-p', true) returning id into p_off_cat;

  insert into public.product_units (product_id, imei, serial_number, storage_gb, color, condition, physical_grade, battery_health, acquisition_cost, sale_price, notes)
    values (p_ip, '490154203237518', 'SERIE-SECRETA-1', 256, 'Negro', 'used', 'Excelente', 91, 7777, 18500, 'nota interna: proveedor X') returning id into u_av;
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price)
    values (p_ip, '352099001761481', 128, 'Azul', 'new', 12000, 21000) returning id into u_av2;
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price, status)
    values (p_ip, '356938035643809', 128, 'Rojo', 'new', 9000, 15000, 'reserved') returning id into u_res;
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price, status)
    values (p_ip, '490154203237526', 64, 'Verde', 'new', 5000, 8000, 'sold') returning id into u_sold;
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price, status)
    values (p_ip, '352099001761499', 64, 'Gris', 'used', 4000, 6000, 'inactive') returning id into u_inact;
  insert into public.product_units (product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price)
    values (p_ip_draft, '356938035643817', 128, 'Negro', 'new', 9000, 15000) returning id into u_draft;

  insert into public.product_variants (product_id, sku, color, compatible_model, price, cost, stock_quantity) values (p_ac, 'T-OK', 'Negro', 'iPhone 15 Pro', 299, 90, 10) returning id into v_ok;
  insert into public.product_variants (product_id, sku, color, price, cost, stock_quantity) values (p_ac, 'T-LOW', 'Rojo', 349, 100, 2) returning id into v_low;
  insert into public.product_variants (product_id, sku, color, price, cost, stock_quantity) values (p_ac, 'T-ZERO', 'Azul', 399, 110, 0) returning id into v_zero;
  insert into public.product_variants (product_id, sku, color, price, cost, stock_quantity, is_active) values (p_ac, 'T-OFF', 'Verde', 499, 120, 5, false) returning id into v_off;

  insert into public.product_images (product_id, storage_path, is_primary) values (p_ip, 'general-ip.jpg', true);
  insert into public.product_images (product_id, product_unit_id, storage_path) values (p_ip, u_av, 'unit-av.jpg');
  insert into public.product_images (product_id, product_unit_id, storage_path) values (p_ip, u_res, 'unit-res.jpg');
  insert into public.product_images (product_id, storage_path, is_primary) values (p_ip_draft, 'draft.jpg', true);

  insert into public.business_settings (key, value, is_public) values
    ('whatsapp_number', '"5512345678"', true), ('delivery_info', '"Entregas a domicilio"', true), ('t_privado', '"secreto"', false);
  select public_code into code_av from public.product_units where id = u_av;

  -- ===== Estructura: las vistas solo tienen columnas publicables (control contra fugas futuras) =====
  select string_agg(column_name, ',' order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'public_units';
  c := (cols = 'public_code,product_id,storage_gb,color,condition,battery_health,physical_grade,price');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'public_units expone exactamente las columnas publicables (sin imei, serie, costo, notas ni codigo interno)' || E'\n'; fails := fails + (not c)::int;
  select string_agg(column_name, ',' order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'public_variants';
  c := (cols = 'id,product_id,sku,color,compatible_model,price,availability');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'public_variants no expone costo ni cantidad de existencias' || E'\n'; fails := fails + (not c)::int;
  select string_agg(column_name, ',' order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'public_products';
  c := (cols = 'id,category_id,kind,name,slug,description,created_at,price_from,price_to,available_count,primary_image_path');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'public_products expone solo columnas publicables' || E'\n'; fails := fails + (not c)::int;
  select string_agg(column_name, ',' order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'public_images';
  c := (cols = 'id,product_id,unit_code,storage_path,alt_text,sort_order,is_primary');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'public_images solo referencia la unidad por su codigo publico' || E'\n'; fails := fails + (not c)::int;
  select string_agg(column_name, ',' order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'public_categories';
  c := (cols = 'id,name,slug,kind,sort_order');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'public_categories solo expone columnas publicables' || E'\n'; fails := fails + (not c)::int;

  -- ===== Visitante =====
  set local role anon;

  select count(*) into n from public.public_products where id in (p_ip, p_ip_draft, p_ac, p_inactive, p_off_cat);
  c := (n = 2 and exists (select 1 from public.public_products where id = p_ip) and exists (select 1 from public.public_products where id = p_ac));
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'solo se ven productos publicados, activos y de categoria activa (no borradores, inactivos ni categoria oculta)' || E'\n'; fails := fails + (not c)::int;
  select count(*) into n from public.public_categories where id in (cat_ip, cat_ac, cat_off);
  c := (n = 2 and not exists (select 1 from public.public_categories where id = cat_off));
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'las categorias inactivas no se publican' || E'\n'; fails := fails + (not c)::int;

  select count(*) into n from public.public_units where product_id in (p_ip, p_ip_draft, p_off_cat);
  c := (n = 2);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'solo se publican iPhone disponibles (no reservados, vendidos, inactivos ni de productos no publicados)' || E'\n'; fails := fails + (not c)::int;
  select * into r from public.public_units where public_code = code_av;
  c := (r.price = 18500 and r.storage_gb = 256 and r.color = 'Negro' and r.condition = 'used' and r.battery_health = 91 and r.physical_grade = 'Excelente');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una unidad publica muestra precio, capacidad, color, condicion, bateria y estado fisico' || E'\n'; fails := fails + (not c)::int;
  c := (code_av ~ '^[0-9A-F]{6}$' and code_av not like 'NC-%');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el codigo publico es aleatorio y distinto del codigo interno secuencial' || E'\n'; fails := fails + (not c)::int;

  select * into r from public.public_products where id = p_ip;
  c := (r.price_from = 18500 and r.price_to = 21000 and r.available_count = 2 and r.primary_image_path = 'general-ip.jpg');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el producto iPhone muestra rango de precios solo de unidades disponibles y su foto principal' || E'\n'; fails := fails + (not c)::int;
  select * into r from public.public_products where id = p_ac;
  c := (r.price_from = 299 and r.price_to = 349 and r.available_count = 2);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el accesorio muestra solo variantes con existencias (sin las agotadas ni inactivas)' || E'\n'; fails := fails + (not c)::int;

  select count(*) into n from public.public_variants where product_id = p_ac;
  c := (n = 3 and not exists (select 1 from public.public_variants where id = v_off));
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'las variantes inactivas no se publican (las agotadas si, como "Agotado")' || E'\n'; fails := fails + (not c)::int;
  c := ((select availability from public.public_variants where id = v_ok) = 'available'
        and (select availability from public.public_variants where id = v_low) = 'low'
        and (select availability from public.public_variants where id = v_zero) = 'out');
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la disponibilidad es un estado (disponible / pocas piezas / agotado), no una cantidad' || E'\n'; fails := fails + (not c)::int;

  select count(*) into n from public.public_images where product_id in (p_ip, p_ip_draft);
  c := (n = 2 and not exists (select 1 from public.public_images where storage_path in ('unit-res.jpg', 'draft.jpg')));
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'no se publican fotos de unidades no disponibles ni de productos no publicados' || E'\n'; fails := fails + (not c)::int;
  c := ((select unit_code from public.public_images where storage_path = 'unit-av.jpg') = code_av);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'la foto de una unidad se asocia por codigo publico' || E'\n'; fails := fails + (not c)::int;

  -- Las tablas privadas siguen cerradas
  begin perform 1 from public.product_units; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer product_units (IMEI, serie, costo)' || E'\n'; fails := fails + (not c)::int;
  begin perform imei from public.product_units; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer la columna imei' || E'\n'; fails := fails + (not c)::int;
  begin perform 1 from public.product_variants; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer product_variants (costo, stock)' || E'\n'; fails := fails + (not c)::int;
  begin perform 1 from public.products; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer products directamente (borradores)' || E'\n'; fails := fails + (not c)::int;
  begin perform 1 from public.product_images; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer product_images directamente' || E'\n'; fails := fails + (not c)::int;
  begin perform 1 from public.inventory_movements; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer movimientos de inventario' || E'\n'; fails := fails + (not c)::int;
  begin perform 1 from public.customers; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer clientes' || E'\n'; fails := fails + (not c)::int;
  begin perform 1 from public.sale_summaries; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer ventas' || E'\n'; fails := fails + (not c)::int;
  begin perform 1 from public.credit_summaries; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer creditos' || E'\n'; fails := fails + (not c)::int;
  begin perform 1 from public.collection_queue; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede leer la cobranza (nombres y telefonos)' || E'\n'; fails := fails + (not c)::int;
  begin insert into public.products (category_id, kind, name, slug) values (cat_ip, 'iphone', 'x', 'x-x'); c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede escribir en el catalogo' || E'\n'; fails := fails + (not c)::int;
  begin update public.public_units set price = 1; c := false; exception when others then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'las vistas publicas no se pueden modificar' || E'\n'; fails := fails + (not c)::int;

  -- Datos publicos del negocio
  select count(*) into n from public.business_settings where key in ('whatsapp_number', 'delivery_info', 't_privado');
  c := (n = 2 and not exists (select 1 from public.business_settings where key = 't_privado'));
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon ve los datos publicos del negocio pero no la configuracion privada' || E'\n'; fails := fails + (not c)::int;
  reset role;

  -- ===== Cambios de estado se reflejan al instante =====
  update public.product_units set status = 'reserved' where id = u_av;
  update public.products set is_published = false where id = p_ac;
  set local role anon;
  c := (not exists (select 1 from public.public_units where public_code = code_av)
        and not exists (select 1 from public.public_products where id = p_ac)
        and not exists (select 1 from public.public_variants where product_id = p_ac));
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'reservar un iPhone o despublicar un producto lo retira de la tienda al instante' || E'\n'; fails := fails + (not c)::int;
  reset role;

  -- ===== Autenticado sin rol de admin: tampoco accede a lo privado por las vistas =====
  update public.product_units set status = 'available' where id = u_av;
  update public.products set is_published = true where id = p_ac;

  -- ===== Validacion de datos del negocio =====
  begin insert into public.business_settings (key, value, is_public) values ('whatsapp_number', '"123"', true); c := false;
  exception when invalid_parameter_value or unique_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un WhatsApp que no tiene 10 digitos es rechazado' || E'\n'; fails := fails + (not c)::int;
  begin update public.business_settings set value = '"55-1234-5678"' where key = 'whatsapp_number'; c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el WhatsApp solo admite digitos' || E'\n'; fails := fails + (not c)::int;
  begin update public.business_settings set is_public = false where key = 'whatsapp_number'; c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un dato publico del negocio no puede ocultarse por error (is_public)' || E'\n'; fails := fails + (not c)::int;
  begin update public.business_settings set value = '12345'::jsonb where key = 'delivery_info'; c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'los datos de contacto deben ser texto' || E'\n'; fails := fails + (not c)::int;
  begin insert into public.business_settings (key, value, is_public) values ('business_address', to_jsonb(repeat('x', 700)), true); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'un texto de contacto demasiado largo es rechazado' || E'\n'; fails := fails + (not c)::int;

  -- ===== Regresiones de la revision adversarial =====
  -- Lista permitida de todo lo que anon puede tocar en la base: si una migracion futura abre algo mas, esta prueba falla.
  select count(*) into n from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public'
    and table_name not in ('business_settings', 'public_categories', 'public_products', 'public_units', 'public_variants', 'public_images');
  c := (n = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no tiene privilegios sobre ninguna otra tabla o vista del esquema public' || E'\n'; fails := fails + (not c)::int;
  select count(*) into n from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public' and privilege_type <> 'SELECT';
  c := (n = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon solo tiene permiso de lectura (SELECT)' || E'\n'; fails := fails + (not c)::int;
  select count(*) into n from information_schema.role_usage_grants where grantee = 'anon' and object_schema = 'public';
  c := (n = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no tiene privilegios sobre secuencias' || E'\n'; fails := fails + (not c)::int;
  select count(*) into n from pg_default_acl d, lateral aclexplode(d.defaclacl) a
  where d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype in ('r', 'S')
    and d.defaclrole = (select oid from pg_roles where rolname = 'postgres')
    and a.grantee = (select oid from pg_roles where rolname = 'anon');
  c := (n = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'los privilegios por defecto ya no conceden nada a anon en objetos nuevos' || E'\n'; fails := fails + (not c)::int;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute');
  c := (n = 0);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'anon no puede ejecutar ninguna funcion del esquema public' || E'\n'; fails := fails + (not c)::int;

  begin insert into public.business_settings (key, value, is_public) values ('zz_notas_internas', '"margen 30%"', true); c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una clave que no esta en la lista no puede ser publica' || E'\n'; fails := fails + (not c)::int;
  begin update public.business_settings set is_public = true where key = 't_privado'; c := false;
  exception when invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una configuracion privada no puede publicarse por error' || E'\n'; fails := fails + (not c)::int;
  begin insert into public.business_settings (key, value, is_public) values ('layaway_min_down_percent', '20'::jsonb, true); c := false;
  exception when invalid_parameter_value or unique_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'las reglas de apartados y creditos nunca se publican' || E'\n'; fails := fails + (not c)::int;
  begin insert into public.business_settings (key, value, is_public) values ('WhatsApp_Number', '{"x":1}'::jsonb, true); c := false;
  exception when check_violation or invalid_parameter_value then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una clave con otras mayusculas no evade la validacion' || E'\n'; fails := fails + (not c)::int;

  -- una foto de un producto que apunta a la unidad de OTRO producto no se publica
  insert into public.product_images (product_id, product_unit_id, storage_path) values (p_ip, u_draft, 'cruzada.jpg');
  set local role anon;
  c := not exists (select 1 from public.public_images where storage_path = 'cruzada.jpg');
  reset role;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'una foto ligada a la unidad de otro producto no revela su codigo publico' || E'\n'; fails := fails + (not c)::int;

  -- ===== Codigo publico: unico, inmutable por el cliente =====
  begin update public.product_units set public_code = 'AAAAAA' where id = u_av2; update public.product_units set public_code = 'AAAAAA' where id = u_res; c := false;
  exception when unique_violation then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el codigo publico es unico' || E'\n'; fails := fails + (not c)::int;
  select count(distinct public_code) into n from public.product_units where product_id in (p_ip, p_ip_draft);
  c := (n = 6);
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'cada unidad nueva recibe su propio codigo publico automaticamente' || E'\n'; fails := fails + (not c)::int;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
  begin update public.product_units set public_code = 'BBBBBB' where id = u_av; c := false; exception when insufficient_privilege then c := true; end;
  report := report || case when c then 'ok   ' else 'FAIL ' end || 'el codigo publico no se puede editar desde el cliente' || E'\n'; fails := fails + (not c)::int;
  reset role;

  raise exception 'TESTS_DONE failures=% %', fails, E'\n' || report;
end;
$test$;
