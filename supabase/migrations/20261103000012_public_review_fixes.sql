-- Correcciones tras la revisión adversarial de la tienda pública (Opus):
--  M1 privilegios por defecto de anon, M2 lista de claves que pueden ser públicas, B1 vista de imágenes coherente,
--  B2 función is_valid_imei no ejecutable por anon, B3 índice para el catálogo, y lectura de Storage para el administrador
--  (permite listar y limpiar fotos huérfanas).

-- M1. Los privilegios por defecto de Supabase concedían TODO a anon sobre tablas, vistas y secuencias nuevas.
-- Cada objeto nuevo debe recibir sus permisos de forma explícita; olvidar un REVOKE ya no abre el objeto al público.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- M2. Solo cinco claves pueden ser públicas, y las claves tienen un formato fijo (sin variantes de mayúsculas).
alter table public.business_settings
  add constraint business_settings_key_format check (key ~ '^[a-z0-9_]+$');

create or replace function public.validate_business_setting()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_public and new.key not in ('whatsapp_number', 'business_name', 'business_hours', 'business_address', 'delivery_info') then
    raise exception 'La clave % no puede ser pública', new.key using errcode = '22023';
  end if;

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

-- B1. Una foto de unidad solo se publica si la unidad pertenece al mismo producto de la foto.
create or replace view public.public_images as
select i.id, i.product_id, u.public_code as unit_code, i.storage_path, i.alt_text, i.sort_order, i.is_primary
from public.product_images i
join public.products p on p.id = i.product_id
join public.categories c on c.id = p.category_id
left join public.product_units u on u.id = i.product_unit_id
where p.is_published and p.is_active and c.is_active
  and (i.product_unit_id is null or (u.status = 'available' and u.product_id = i.product_id));

-- B2. Una función pura no expone datos, pero "denegar por defecto" también aplica a anon.
revoke execute on function public.is_valid_imei(text) from public, anon;
grant execute on function public.is_valid_imei(text) to authenticated;

-- B3. Índice parcial para las subconsultas del catálogo público.
create index if not exists product_units_available_idx on public.product_units (product_id) where status = 'available';

-- El administrador puede listar los archivos de fotos (para detectar y limpiar huérfanos desde la aplicación).
create policy product_images_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()));
