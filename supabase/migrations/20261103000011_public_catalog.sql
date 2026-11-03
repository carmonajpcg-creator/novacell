-- Fase 6: tienda pública. Reglas PROPUESTAS y pendientes de aprobación: docs/PENDING_RULES.md (S1..S9).
-- Diseño de seguridad (CLAUDE.md §17): las tablas privadas NO se tocan. El visitante (anon) solo puede leer VISTAS
-- que contienen únicamente columnas publicables. Nunca se exponen IMEI, número de serie, costos, notas internas,
-- clientes, créditos, pagos ni cantidades exactas de existencias.

-- ---------------------------------------------------------------------------
-- Código público de cada unidad: aleatorio y sin relación con el código interno secuencial (NC-000001),
-- que revelaría el tamaño del inventario.
-- ---------------------------------------------------------------------------
alter table public.product_units add column public_code text;

update public.product_units
set public_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
where public_code is null;

alter table public.product_units
  alter column public_code set not null,
  add constraint product_units_public_code_key unique (public_code),
  add constraint product_units_public_code_format check (public_code ~ '^[0-9A-F]{6}$');

create or replace function public.set_unit_public_code()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  candidate text;
begin
  if new.public_code is null then
    loop
      candidate := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      exit when not exists (select 1 from public.product_units where public_code = candidate);
    end loop;
    new.public_code := candidate;
  end if;
  return new;
end;
$$;
revoke execute on function public.set_unit_public_code() from public, anon, authenticated;
create trigger product_units_public_code before insert on public.product_units
  for each row execute function public.set_unit_public_code();

-- ---------------------------------------------------------------------------
-- Vistas públicas (propietario = postgres; solo columnas publicables; solo lo publicado)
-- ---------------------------------------------------------------------------
create view public.public_categories as
select c.id, c.name, c.slug, c.kind, c.sort_order
from public.categories c
where c.is_active;

create view public.public_products as
select
  p.id, p.category_id, p.kind, p.name, p.slug, p.description, p.created_at,
  case p.kind
    when 'iphone' then (select min(u.sale_price) from public.product_units u where u.product_id = p.id and u.status = 'available')
    else (select min(v.price) from public.product_variants v where v.product_id = p.id and v.is_active and v.stock_quantity > 0)
  end as price_from,
  case p.kind
    when 'iphone' then (select max(u.sale_price) from public.product_units u where u.product_id = p.id and u.status = 'available')
    else (select max(v.price) from public.product_variants v where v.product_id = p.id and v.is_active and v.stock_quantity > 0)
  end as price_to,
  case p.kind
    when 'iphone' then (select count(*) from public.product_units u where u.product_id = p.id and u.status = 'available')
    else (select count(*) from public.product_variants v where v.product_id = p.id and v.is_active and v.stock_quantity > 0)
  end::integer as available_count,
  (select i.storage_path from public.product_images i
   where i.product_id = p.id and i.product_unit_id is null
   order by i.is_primary desc, i.sort_order, i.created_at limit 1) as primary_image_path
from public.products p
join public.categories c on c.id = p.category_id
where p.is_published and p.is_active and c.is_active;

-- iPhone disponibles: sin IMEI, serie, costo, notas ni código interno.
create view public.public_units as
select u.public_code, u.product_id, u.storage_gb, u.color, u.condition, u.battery_health, u.physical_grade,
       u.sale_price as price
from public.product_units u
join public.products p on p.id = u.product_id
join public.categories c on c.id = p.category_id
where u.status = 'available' and p.is_published and p.is_active and c.is_active;

-- Accesorios: la disponibilidad es un estado, no una cantidad (umbral "pocas piezas" propuesto: 3).
create view public.public_variants as
select v.id, v.product_id, v.sku, v.color, v.compatible_model, v.price,
       case when v.stock_quantity <= 0 then 'out' when v.stock_quantity <= 3 then 'low' else 'available' end as availability
from public.product_variants v
join public.products p on p.id = v.product_id
join public.categories c on c.id = p.category_id
where v.is_active and p.is_published and p.is_active and c.is_active;

create view public.public_images as
select i.id, i.product_id, u.public_code as unit_code, i.storage_path, i.alt_text, i.sort_order, i.is_primary
from public.product_images i
join public.products p on p.id = i.product_id
join public.categories c on c.id = p.category_id
left join public.product_units u on u.id = i.product_unit_id
where p.is_published and p.is_active and c.is_active
  and (i.product_unit_id is null or u.status = 'available');

revoke all on public.public_categories, public.public_products, public.public_units,
  public.public_variants, public.public_images from public, anon, authenticated;
grant select on public.public_categories, public.public_products, public.public_units,
  public.public_variants, public.public_images to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Datos públicos del negocio (business_settings con is_public = true; los edita el administrador)
-- ---------------------------------------------------------------------------
create or replace function public.validate_business_setting()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.key = 'layaway_min_down_percent' then
    if jsonb_typeof(new.value) <> 'number' then
      raise exception 'layaway_min_down_percent debe ser un número entre 0 y 100' using errcode = '22023';
    end if;
    if (new.value #>> '{}')::numeric < 0 or (new.value #>> '{}')::numeric > 100 then
      raise exception 'layaway_min_down_percent debe estar entre 0 y 100' using errcode = '22023';
    end if;
  elsif new.key = 'credit_allowed_frequencies' then
    if jsonb_typeof(new.value) <> 'array' or jsonb_array_length(new.value) = 0
       or exists (select 1 from jsonb_array_elements_text(new.value) f where f not in ('weekly', 'biweekly', 'monthly')) then
      raise exception 'credit_allowed_frequencies debe ser una lista no vacía de weekly, biweekly o monthly' using errcode = '22023';
    end if;
  elsif new.key in ('whatsapp_number', 'business_name', 'business_hours', 'business_address', 'delivery_info') then
    if jsonb_typeof(new.value) <> 'string' then
      raise exception '% debe ser texto', new.key using errcode = '22023';
    end if;
    if not new.is_public then
      raise exception '% es un dato público del negocio (is_public debe ser verdadero)', new.key using errcode = '22023';
    end if;
    if new.key = 'whatsapp_number' and (new.value #>> '{}') !~ '^[0-9]{10}$' then
      raise exception 'whatsapp_number debe tener 10 dígitos' using errcode = '22023';
    end if;
    if new.key = 'business_name' and length(trim(new.value #>> '{}')) not between 1 and 80 then
      raise exception 'business_name debe tener entre 1 y 80 caracteres' using errcode = '22023';
    end if;
    if new.key <> 'whatsapp_number' and new.key <> 'business_name' and length(new.value #>> '{}') > 600 then
      raise exception '% admite hasta 600 caracteres', new.key using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
