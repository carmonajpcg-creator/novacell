-- Permite borrar categorías/productos creados por error. Las claves foráneas (ON DELETE RESTRICT)
-- impiden borrar los que ya tienen productos, variantes, unidades o historial: esos se desactivan.
grant delete on public.categories, public.products to authenticated;
