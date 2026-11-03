-- Higiene: las funciones de trigger no deben ser ejecutables por PUBLIC (no se usan desde el cliente).
revoke execute on function public.set_updated_at() from public;
revoke execute on function public.enforce_product_kind() from public;
revoke execute on function public.block_movement_changes() from public;
