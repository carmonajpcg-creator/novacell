-- Fase 2: productos e inventario.
-- Todo es privado (solo administrador) hasta la Fase 6, cuando se definan las vistas
-- públicas sin IMEI ni costos. El stock y el estado de las unidades solo cambian mediante
-- funciones RPC con historial (inventory_movements) y claves de idempotencia.

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------
create or replace function public.assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
end;
$$;

-- IMEI: 15 dígitos y dígito verificador (Luhn).
create or replace function public.is_valid_imei(p text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  total int := 0;
  digit int;
  i int;
  dbl boolean := false;
begin
  if p is null or p !~ '^[0-9]{15}$' then
    return false;
  end if;
  for i in reverse 15..1 loop
    digit := substr(p, i, 1)::int;
    if dbl then
      digit := digit * 2;
      if digit > 9 then digit := digit - 9; end if;
    end if;
    total := total + digit;
    dbl := not dbl;
  end loop;
  return total % 10 = 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kind text not null check (kind in ('iphone', 'accessory')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, kind)
);
create trigger categories_set_updated_at before update on public.categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- products: un iPhone es un "modelo"; las unidades físicas viven en product_units.
-- Un accesorio tiene variantes (product_variants).
-- ---------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null,
  kind text not null check (kind in ('iphone', 'accessory')),
  name text not null check (length(trim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text check (description is null or length(description) <= 4000),
  is_published boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- el tipo del producto debe coincidir con el de su categoría
  foreign key (category_id, kind) references public.categories (id, kind) on delete restrict
);
create index products_category_idx on public.products (category_id);
create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();

create or replace function public.enforce_product_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  expected text := tg_argv[0];
  actual text;
begin
  select kind into actual from public.products where id = new.product_id;
  if actual is distinct from expected then
    raise exception 'El producto debe ser de tipo %', expected using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- product_variants (accesorios): SKU, color, modelo compatible, precio, costo y existencias.
-- stock_quantity solo cambia mediante adjust_variant_stock().
-- ---------------------------------------------------------------------------
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  sku text not null unique check (length(trim(sku)) between 1 and 60),
  color text check (color is null or length(trim(color)) between 1 and 60),
  compatible_model text check (compatible_model is null or length(trim(compatible_model)) between 1 and 120),
  price numeric(14, 2) not null check (price >= 0),
  cost numeric(14, 2) not null check (cost >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index product_variants_product_idx on public.product_variants (product_id);
create trigger product_variants_set_updated_at before update on public.product_variants
  for each row execute function public.set_updated_at();
create trigger product_variants_kind before insert or update of product_id on public.product_variants
  for each row execute function public.enforce_product_kind('accessory');

-- ---------------------------------------------------------------------------
-- product_units (iPhone): cada equipo se identifica por IMEI único y privado.
-- status solo cambia mediante RPC (ventas/apartados en fases posteriores).
-- ---------------------------------------------------------------------------
create sequence public.product_unit_code_seq;

create table public.product_units (
  id uuid primary key default gen_random_uuid(),
  internal_code text not null unique
    default ('NC-' || lpad(nextval('public.product_unit_code_seq')::text, 6, '0')),
  product_id uuid not null references public.products (id) on delete restrict,
  imei text not null unique check (public.is_valid_imei(imei)),
  serial_number text unique check (serial_number is null or length(trim(serial_number)) between 1 and 40),
  storage_gb integer not null check (storage_gb > 0),
  color text not null check (length(trim(color)) between 1 and 60),
  condition text not null check (condition in ('new', 'used')),
  physical_grade text check (physical_grade is null or length(trim(physical_grade)) between 1 and 200),
  battery_health smallint check (battery_health is null or battery_health between 0 and 100),
  status text not null default 'available' check (status in ('available', 'reserved', 'sold', 'inactive')),
  acquisition_cost numeric(14, 2) not null check (acquisition_cost >= 0),
  sale_price numeric(14, 2) not null check (sale_price >= 0),
  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index product_units_product_idx on public.product_units (product_id);
create index product_units_status_idx on public.product_units (status);
create trigger product_units_set_updated_at before update on public.product_units
  for each row execute function public.set_updated_at();
create trigger product_units_kind before insert or update of product_id on public.product_units
  for each row execute function public.enforce_product_kind('iphone');

-- ---------------------------------------------------------------------------
-- product_images: fotografías del producto o de una unidad concreta.
-- ---------------------------------------------------------------------------
create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  product_unit_id uuid references public.product_units (id) on delete cascade,
  storage_path text not null unique check (length(storage_path) between 1 and 300),
  alt_text text check (alt_text is null or length(alt_text) <= 200),
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index product_images_product_idx on public.product_images (product_id);
create unique index product_images_one_primary_idx on public.product_images (product_id)
  where is_primary and product_unit_id is null;

-- ---------------------------------------------------------------------------
-- inventory_movements: historial de solo inserción.
-- ---------------------------------------------------------------------------
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_unit_id uuid references public.product_units (id) on delete restrict,
  product_variant_id uuid references public.product_variants (id) on delete restrict,
  movement_type text not null check (movement_type in ('entry', 'exit', 'adjustment')),
  quantity_delta integer not null check (quantity_delta <> 0),
  stock_after integer check (stock_after is null or stock_after >= 0),
  reason text check (reason is null or length(reason) <= 500),
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 100),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(product_unit_id, product_variant_id) = 1),
  check (product_unit_id is null or quantity_delta in (-1, 1)),
  check (movement_type <> 'entry' or quantity_delta > 0),
  check (movement_type <> 'exit' or quantity_delta < 0),
  check (movement_type <> 'adjustment' or length(trim(coalesce(reason, ''))) > 0)
);
create index inventory_movements_unit_idx on public.inventory_movements (product_unit_id, created_at desc);
create index inventory_movements_variant_idx on public.inventory_movements (product_variant_id, created_at desc);

create or replace function public.block_movement_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'inventory_movements es de solo inserción' using errcode = '42501';
end;
$$;
create trigger inventory_movements_append_only before update or delete on public.inventory_movements
  for each row execute function public.block_movement_changes();

-- ---------------------------------------------------------------------------
-- RPC: registrar una unidad iPhone (alta + movimiento de entrada, atómico e idempotente)
-- ---------------------------------------------------------------------------
create or replace function public.register_unit(
  p_product_id uuid,
  p_imei text,
  p_serial_number text,
  p_storage_gb integer,
  p_color text,
  p_condition text,
  p_physical_grade text,
  p_battery_health integer,
  p_acquisition_cost numeric,
  p_sale_price numeric,
  p_notes text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing uuid;
  new_id uuid;
begin
  perform public.assert_admin();

  select product_unit_id into existing
  from public.inventory_movements where idempotency_key = p_idempotency_key;
  if existing is not null then
    return existing;
  end if;

  insert into public.product_units (
    product_id, imei, serial_number, storage_gb, color, condition, physical_grade,
    battery_health, acquisition_cost, sale_price, notes
  ) values (
    p_product_id, p_imei, nullif(trim(p_serial_number), ''), p_storage_gb, p_color, p_condition,
    nullif(trim(p_physical_grade), ''), p_battery_health, p_acquisition_cost, p_sale_price,
    nullif(trim(p_notes), '')
  ) returning id into new_id;

  insert into public.inventory_movements (product_unit_id, movement_type, quantity_delta, reason, idempotency_key)
  values (new_id, 'entry', 1, 'Alta de unidad', p_idempotency_key);

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'register_unit', 'product_units', new_id, jsonb_build_object('product_id', p_product_id));

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: activar/desactivar una unidad (available <-> inactive)
-- ---------------------------------------------------------------------------
create or replace function public.set_unit_active(
  p_unit_id uuid,
  p_active boolean,
  p_reason text,
  p_idempotency_key text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  perform public.assert_admin();

  if exists (select 1 from public.inventory_movements where idempotency_key = p_idempotency_key) then
    return (select status from public.product_units where id = p_unit_id);
  end if;

  select status into current_status from public.product_units where id = p_unit_id for update;
  if current_status is null then
    raise exception 'Unidad no encontrada' using errcode = 'P0002';
  end if;

  if p_active then
    if current_status <> 'inactive' then
      raise exception 'Solo se puede activar una unidad inactiva (estado actual: %)', current_status
        using errcode = '23514';
    end if;
    update public.product_units set status = 'available' where id = p_unit_id;
    insert into public.inventory_movements (product_unit_id, movement_type, quantity_delta, reason, idempotency_key)
    values (p_unit_id, 'adjustment', 1, p_reason, p_idempotency_key);
    return 'available';
  else
    if current_status <> 'available' then
      raise exception 'Solo se puede desactivar una unidad disponible (estado actual: %)', current_status
        using errcode = '23514';
    end if;
    update public.product_units set status = 'inactive' where id = p_unit_id;
    insert into public.inventory_movements (product_unit_id, movement_type, quantity_delta, reason, idempotency_key)
    values (p_unit_id, 'adjustment', -1, p_reason, p_idempotency_key);
    return 'inactive';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: mover existencias de una variante (entrada, salida o ajuste). Sin stock negativo.
-- ---------------------------------------------------------------------------
create or replace function public.adjust_variant_stock(
  p_variant_id uuid,
  p_type text,
  p_delta integer,
  p_reason text,
  p_idempotency_key text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior integer;
  new_stock integer;
begin
  perform public.assert_admin();

  select stock_after into new_stock
  from public.inventory_movements where idempotency_key = p_idempotency_key;
  if found then
    return new_stock;
  end if;

  if p_type not in ('entry', 'exit', 'adjustment') then
    raise exception 'Tipo de movimiento inválido' using errcode = '22023';
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception 'La cantidad no puede ser cero' using errcode = '22023';
  end if;

  select stock_quantity into prior from public.product_variants where id = p_variant_id for update;
  if prior is null then
    raise exception 'Variante no encontrada' using errcode = 'P0002';
  end if;

  new_stock := prior + p_delta;
  if new_stock < 0 then
    raise exception 'Existencias insuficientes (disponibles: %)', prior using errcode = '23514';
  end if;

  insert into public.inventory_movements (
    product_variant_id, movement_type, quantity_delta, stock_after, reason, idempotency_key
  ) values (p_variant_id, p_type, p_delta, new_stock, p_reason, p_idempotency_key);

  update public.product_variants set stock_quantity = new_stock where id = p_variant_id;
  return new_stock;
end;
$$;

revoke all on function public.assert_admin() from public;
revoke all on function public.register_unit(uuid, text, text, integer, text, text, text, integer, numeric, numeric, text, text) from public;
revoke all on function public.set_unit_active(uuid, boolean, text, text) from public;
revoke all on function public.adjust_variant_stock(uuid, text, integer, text, text) from public;
grant execute on function public.register_unit(uuid, text, text, integer, text, text, text, integer, numeric, numeric, text, text) to authenticated;
grant execute on function public.set_unit_active(uuid, boolean, text, text) to authenticated;
grant execute on function public.adjust_variant_stock(uuid, text, integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Privilegios: mínimo necesario. Sin DELETE salvo imágenes; los productos se desactivan.
-- Las columnas críticas (stock, status) no son escribibles por el cliente.
-- ---------------------------------------------------------------------------
revoke all on public.categories, public.products, public.product_variants, public.product_units,
  public.product_images, public.inventory_movements from anon, authenticated;

grant select on public.categories, public.products, public.product_variants, public.product_units,
  public.product_images, public.inventory_movements to authenticated;

grant insert, update on public.categories to authenticated;
grant insert, update on public.products to authenticated;
grant insert (product_id, sku, color, compatible_model, price, cost, is_active) on public.product_variants to authenticated;
grant update (sku, color, compatible_model, price, cost, is_active) on public.product_variants to authenticated;
grant update (serial_number, imei, storage_gb, color, condition, physical_grade, battery_health,
  acquisition_cost, sale_price, notes) on public.product_units to authenticated;
grant insert, update, delete on public.product_images to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: solo el administrador.
-- ---------------------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_units enable row level security;
alter table public.product_images enable row level security;
alter table public.inventory_movements enable row level security;

create policy categories_admin on public.categories for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy products_admin on public.products for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy product_variants_admin on public.product_variants for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy product_units_admin on public.product_units for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy product_images_admin on public.product_images for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy inventory_movements_admin_select on public.inventory_movements for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Storage: bucket de fotografías. Lectura por URL (se publicarán en la tienda);
-- escritura solo del administrador. Las rutas llevan UUID.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy product_images_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (select public.is_admin()));
create policy product_images_storage_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()))
  with check (bucket_id = 'product-images' and (select public.is_admin()));
create policy product_images_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()));
