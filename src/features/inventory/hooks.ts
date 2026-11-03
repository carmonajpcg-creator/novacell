import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import * as api from './api'

export function client(): SupabaseClient {
  if (!supabase) throw new Error('Supabase no está configurado')
  return supabase
}

export const keys = {
  categories: ['categories'] as const,
  products: ['products'] as const,
  product: (id: string) => ['product', id] as const,
  variants: (productId: string) => ['variants', productId] as const,
  units: ['units'] as const,
  unitsByProduct: (productId: string) => ['units', productId] as const,
  movements: ['movements'] as const,
  images: (productId: string) => ['images', productId] as const,
}

export const useCategories = () => useQuery({ queryKey: keys.categories, queryFn: () => api.listCategories(client()) })
export const useProducts = () => useQuery({ queryKey: keys.products, queryFn: () => api.listProducts(client()) })
export const useProduct = (id: string) =>
  useQuery({ queryKey: keys.product(id), queryFn: () => api.getProduct(client(), id) })
export const useVariants = (productId: string) =>
  useQuery({ queryKey: keys.variants(productId), queryFn: () => api.listVariants(client(), productId) })
export const useUnits = () => useQuery({ queryKey: keys.units, queryFn: () => api.listUnits(client()) })
export const useUnitsByProduct = (productId: string) =>
  useQuery({ queryKey: keys.unitsByProduct(productId), queryFn: () => api.listUnitsByProduct(client(), productId) })
export const useMovements = () => useQuery({ queryKey: keys.movements, queryFn: () => api.listMovements(client()) })
export const useImages = (productId: string) =>
  useQuery({ queryKey: keys.images(productId), queryFn: () => api.listImages(client(), productId) })

/** Mutación que invalida las consultas indicadas al terminar con éxito. */
export function useInvalidatingMutation<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  invalidate: readonly (readonly unknown[])[],
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey }))),
  })
}
